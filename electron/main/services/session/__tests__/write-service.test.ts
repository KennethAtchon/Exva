import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/instruments/session-instrument-classes";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { EventsRepo } from "../../../db/repositories/system/events-repo";
import { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/sessions/session-research-posture-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/sessions/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/sessions/session-selector-settings-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/sessions/session-timeframe-config-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/sessions/session-trade-rules-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import { SessionWriteService } from "../write-service";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { sessionRequiresInstrumentScope } from "@electron/shared/domain";

describe("SessionWriteService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("creates a focused session with broker assignments and routing overrides", () => {
    const service = createService(db);
    new WorkspacePreferencesRepo(db).update({
      defaultModelProviderKey: "provider-openrouter",
      defaultModelModelId: "google/gemma-4-31b-it",
    });
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "live",
    });
    insertBroker(db, {
      id: "broker-crypto",
      name: "Crypto Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "live",
    });

    const result = service.create({
      name: "Dual Market Session",
      objective: "Trade both stocks and crypto",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock", "crypto"],
      instrumentScope: "NVDA, BTC-USD",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "live_allowed",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
        { brokerAccountId: "broker-crypto", allocatedUsd: 2500 },
      ],
      brokerOverridesByInstrumentClass: {
        stock: "broker-stock",
        crypto: "broker-crypto",
      },
    });

    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const routing = new BrokerRoutingRepo(db);
    const selectorSettings = new SessionSelectorSettingsRepo(db);
    const aiPhases = new SessionAiPhasesRepo(db).listBySession(result.id);
    const researchPosture = new SessionResearchPostureRepo(db).get(result.id);
    const tradeRules = new SessionTradeRulesRepo(db).get(result.id);
    const riskConfig = new SessionRiskConfigRepo(db).get(result.id);
    const timeframe = new SessionTimeframeConfigRepo(db).get(result.id);

    expect(result.status).toBe("draft");
    expect(sessions.getFocusedSessionId()).toBe(result.id);
    expect(assignments.listBrokerAccountIds(result.id)).toEqual([
      "broker-crypto",
      "broker-stock",
    ]);
    expect(assignments.listAssignments(result.id)).toEqual([
      { brokerAccountId: "broker-crypto", allocatedUsd: 2500 },
      { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
    ]);
    expect(routing.listSessionOverrides(result.id)).toEqual([
      {
        sessionId: result.id,
        instrumentClass: "crypto",
        brokerAccountId: "broker-crypto",
      },
      {
        sessionId: result.id,
        instrumentClass: "stock",
        brokerAccountId: "broker-stock",
      },
    ]);
    expect(selectorSettings.get(result.id).aiPickerEnabled).toBe(false);
    expect(aiPhases).toHaveLength(5);
    expect(aiPhases.every((p) => p.providerKey === "provider-openrouter")).toBe(
      true,
    );
    expect(aiPhases.every((p) => p.modelId === "google/gemma-4-31b-it")).toBe(
      true,
    );
    expect(researchPosture.posturePresetId).toBe("edgar_catalyst");
    expect(tradeRules.rulesPresetId).toBe("catalyst_entry");
    expect(riskConfig.riskPresetId).toBe("moderate");
    expect(timeframe.timeframePresetId).toBe("catalyst");
  });

  it("leaves new session AI roles blank when no workspace default model is configured", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    const result = service.create({
      name: "Blank Role Session",
      objective: "Trade stocks later",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "SPY",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
      ],
    });

    const aiPhases = new SessionAiPhasesRepo(db).listBySession(result.id);
    expect(aiPhases).toHaveLength(5);
    expect(aiPhases.every((p) => p.providerKey === "")).toBe(true);
    expect(aiPhases.every((p) => p.modelId === "")).toBe(true);
  });

  it("rejects broker assignments that do not support the session instrument classes", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Only",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    expect(() =>
      service.create({
        name: "Crypto Session",
        objective: "Trade BTC",
        selectionMode: "manual_shortlist",
        instrumentClasses: ["crypto"],
        instrumentScope: "BTC-USD",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        brokerAssignments: [
          { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
        ],
      }),
    ).toThrowError(/does not support any of the selected instrument classes/i);
  });

  it("derives instrument classes from selected brokers in full-universe mode", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });
    insertBroker(db, {
      id: "broker-crypto",
      name: "Crypto Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "paper",
    });

    const result = service.create({
      name: "Broker Driven Universe",
      objective: "Let brokers define the searchable classes",
      selectionMode: "ai_selected_universe",
      instrumentClasses: ["futures"],
      instrumentScope: SEARCH_EVERYTHING_SCOPE,
      selectorSettings: { aiPickerEnabled: true },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 1250 },
        { brokerAccountId: "broker-crypto", allocatedUsd: 1250 },
      ],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["stock", "crypto"]);
  });

  it("allows empty instrument scope for listener-only signal subscriptions", () => {
    const signalSourcesRepo = new SignalSourcesRepo(db);
    const edgarSourceId = "edgar-source-1";
    signalSourcesRepo.create({
      id: edgarSourceId,
      type: "edgar_8k",
      name: "EDGAR 8-K",
      description: null,
      enabled: true,
      configJson: "{}",
    });
    const service = createService(db, {
      signalSourcesRepo,
    });
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    const result = service.create({
      name: "EDGAR Listener Session",
      objective: "React to filings automatically",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: true },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
      ],
      subscribedSourceIds: [edgarSourceId],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentScope).toBe("");
  });

  it("rejects empty instrument scope when no signal subscriptions exist", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    expect(() =>
      service.create({
        name: "Manual Session",
        objective: "Needs tickers",
        selectionMode: "manual_shortlist",
        instrumentClasses: ["stock"],
        instrumentScope: "",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        brokerAssignments: [
          { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
        ],
      }),
    ).toThrowError(/instrument scope cannot be empty/i);
  });
});

function createService(
  db: ReturnType<typeof createTestDb>,
  options?: { signalSourcesRepo?: SignalSourcesRepo },
): SessionWriteService {
  const signalSourcesRepo = options?.signalSourcesRepo;
  const signals = signalSourcesRepo
    ? {
        replaceSessionSubscriptions: () => undefined,
        requiresInstrumentScopeForSourceIds: (sourceIds: string[]) => {
          const subscribedSources = sourceIds.flatMap((sourceId) => {
            const source = signalSourcesRepo.get(sourceId);
            return source ? [{ type: source.type }] : [];
          });
          return sessionRequiresInstrumentScope(subscribedSources);
        },
      }
    : undefined;

  return new SessionWriteService({
    sessions: new SessionRepo(db),
    events: new EventsRepo(db),
    selectorSettings: new SessionSelectorSettingsRepo(db),
    assignments: new SessionBrokerAssignmentsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
    signals,
  });
}

function insertBroker(
  db: ReturnType<typeof createTestDb>,
  input: {
    id: string;
    name: string;
    brokerType: string;
    supportedInstrumentClasses: Array<
      "stock" | "crypto" | "futures" | "prediction_market"
    >;
    mode: "paper" | "live";
  },
): void {
  new BrokerAccountsRepo(db).insert({
    ...input,
    secretRef: `broker:${input.id}`,
  });
}
