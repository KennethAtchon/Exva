import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../../db/test-fixtures";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { ProviderAccountsRepo } from "../../../db/repositories/workspace/provider-accounts-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { SessionStrategyConfigService } from "../session-strategy-config-service";
import { SessionStrategyContextService } from "../session-strategy-context-service";
import { runPreflight } from "./index";

describe("runPreflight", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("passes when all six checks succeed", async () => {
    const harness = createHarness(db);
    const session = harness.createReadySession();

    await expect(runPreflight(session, harness.deps)).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    {
      check: "task-boundary",
      mutate: (session: ReturnType<typeof createMinimalSession>) => ({
        ...session,
        objective: "",
      }),
      code: "VALIDATION_FAILED",
    },
    {
      check: "provider-credentials",
      mutate: (session: ReturnType<typeof createMinimalSession>) => session,
      setup: (
        harness: ReturnType<typeof createHarness>,
        session: ReturnType<typeof createMinimalSession>,
      ) => {
        harness.clearAiProvider(session.id);
      },
      code: "PROVIDER_NOT_CONFIGURED",
    },
    {
      check: "broker-reachability",
      mutate: (session: ReturnType<typeof createMinimalSession>) => session,
      setup: (harness: ReturnType<typeof createHarness>) => {
        harness.setBrokerReachable(false);
      },
      code: "BROKER_UNREACHABLE",
    },
    {
      check: "broker-allocation",
      mutate: (session: ReturnType<typeof createMinimalSession>) => session,
      setup: (harness: ReturnType<typeof createHarness>) => {
        harness.setCapitalCheck({
          ok: false,
          failures: [
            {
              reason: "allocation_exceeded",
              detail: "Allocation exceeds available capital.",
            },
          ],
        });
      },
      code: "BROKER_ALLOCATION_EXCEEDED",
    },
    {
      check: "selector-config",
      mutate: (session: ReturnType<typeof createMinimalSession>) => ({
        ...session,
        selectionMode: "ai_selected_universe" as const,
        defaultSearchProviderId: null,
      }),
      setup: (harness: ReturnType<typeof createHarness>) => {
        harness.enableAiPicker();
        harness.clearSearchProvider();
      },
      code: "SEARCH_PROVIDER_REQUIRED",
    },
    {
      check: "instrument-conflict",
      mutate: (session: ReturnType<typeof createMinimalSession>) => ({
        ...session,
        instrumentScope: "NVDA",
      }),
      setup: (harness: ReturnType<typeof createHarness>) => {
        harness.setInstrumentConflict(true);
      },
      code: "INSTRUMENT_CONFLICT",
    },
  ])(
    "returns actionable failure for $check",
    async ({ check, mutate, setup, code }) => {
      const harness = createHarness(db);
      const session = harness.createReadySession();
      setup?.(harness, session);
      const finalSession = mutate(session);

      const result = await runPreflight(finalSession, harness.deps);
      expect(result).toMatchObject({
        ok: false,
        check,
        code,
      });
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(0);
      }
    },
  );
});

function createHarness(db: ReturnType<typeof createTestDb>) {
  const sessions = new SessionRepo(db);
  const brokers = new BrokerAccountsRepo(db);
  const assignments = new SessionBrokerAssignmentsRepo(db);
  const routingRepo = new BrokerRoutingRepo(db);
  const providerAccounts = new ProviderAccountsRepo(db);
  const workspacePreferences = new WorkspacePreferencesRepo(db);
  const strategyConfig = new SessionStrategyConfigService(db);
  const strategyContextService = new SessionStrategyContextService({
    sessionRepo: sessions,
    strategyConfig,
    providerAccountsRepo: providerAccounts,
    workspacePrefsRepo: workspacePreferences,
  });
  const signalSourcesRepo = new SignalSourcesRepo(db);

  insertBrokerAccount(db, { id: "broker-stock" });

  let brokerReachable = true;
  let instrumentConflict = false;
  let capitalCheck:
    | { ok: true }
    | { ok: false; failures: Array<{ reason: string; detail: string }> } = {
    ok: true,
  };

  const brokerRegistry = {
    get: async () => ({
      testConnection: async () =>
        brokerReachable
          ? { ok: true as const }
          : { ok: false as const, message: "offline" },
    }),
  };

  const routing = new BrokerRoutingService(
    brokers,
    assignments,
    routingRepo,
    brokerRegistry as never,
  );

  configureAiProvider();

  const deps = {
    sessionRepo: sessions,
    strategyContextService,
    sessionBrokerAssignmentsRepo: assignments,
    brokerAccountsRepo: brokers,
    brokerRouting: routing,
    brokerRegistry: brokerRegistry as never,
    brokerBalanceCache: {
      refreshAll: async () => [{ id: "broker-stock", balanceUsd: 10_000 }],
    },
    brokerCapital: {
      checkSessionStartFits: () => capitalCheck,
    },
    providerAccountsRepo: providerAccounts,
    workspacePreferencesRepo: workspacePreferences,
    signalSourcesRepo,
    tradesRepo: {
      checkInstrumentConflict: () => instrumentConflict,
    },
  } as never;

  return {
    deps,
    createReadySession() {
      const session = createMinimalSession(db, {
        name: "Ready Session",
        objective: "Trade NVDA",
        instrumentClasses: ["stock"],
        instrumentScope: "NVDA",
        selectionMode: "manual_shortlist",
        executionMode: "paper_only",
        experienceId: "edgar-catalyst",
      });
      assignments.replaceAssignments(session.id, [
        { brokerAccountId: "broker-stock", allocatedUsd: 5000 },
      ]);
      routingRepo.upsertSessionOverrides(session.id, [
        { instrumentClass: "stock", brokerAccountId: "broker-stock" },
      ]);
      strategyContextService.saveSelectorSettings(session.id, {
        aiPickerEnabled: false,
      });
      configureAiProvider(session.id);
      const edgarSourceId = "edgar-source";
      if (!signalSourcesRepo.get(edgarSourceId)) {
        signalSourcesRepo.create({
          id: edgarSourceId,
          type: "edgar_8k",
          name: "EDGAR 8-K",
          description: null,
          enabled: true,
          configJson: "{}",
        });
      }
      return sessions.requireById(session.id);
    },
    clearAiProvider(sessionId: string) {
      for (const phase of strategyContextService.listAiPhases(sessionId)) {
        strategyContextService.saveAiPhase(sessionId, {
          phase: phase.phase,
          providerKey: "",
          modelId: "",
        });
      }
    },
    setBrokerReachable(value: boolean) {
      brokerReachable = value;
    },
    setCapitalCheck(
      value:
        | { ok: true }
        | { ok: false; failures: Array<{ reason: string; detail: string }> },
    ) {
      capitalCheck = value;
    },
    enableAiPicker() {
      for (const session of sessions.list()) {
        strategyContextService.saveSelectorSettings(session.id, {
          aiPickerEnabled: true,
        });
      }
    },
    clearSearchProvider() {
      workspacePreferences.update({ defaultSearchProviderId: null });
    },
    setInstrumentConflict(value: boolean) {
      instrumentConflict = value;
    },
  };

  function configureAiProvider(sessionId?: string) {
    providerAccounts.upsert({
      id: "provider-openrouter",
      name: "OpenRouter",
      category: "ai",
      providerType: "openrouter",
      secretRef: "provider:provider-openrouter",
      metadataJson: null,
      isConfigured: true,
    });
    workspacePreferences.update({
      defaultModelProviderKey: "provider-openrouter",
      defaultModelModelId: "google/gemma-4-31b-it",
    });
    const targets = sessionId
      ? [sessions.requireById(sessionId)]
      : sessions.list();
    for (const session of targets) {
      for (const phase of strategyContextService.listAiPhases(session.id)) {
        strategyContextService.saveAiPhase(session.id, {
          phase: phase.phase,
          providerKey: "provider-openrouter",
          modelId: "google/gemma-4-31b-it",
        });
      }
    }
  }
}
