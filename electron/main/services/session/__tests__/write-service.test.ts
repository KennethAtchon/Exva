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
import { requireExperience } from "../../../experiences/index";

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

    const result = service.create({
      name: "Dual Broker Session",
      objective: "Trade stocks via EDGAR catalyst",
      selectionMode: "manual_shortlist",
      instrumentScope: "NVDA",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "live_allowed",
      experienceId: "edgar-catalyst",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 5000 },
      ],
      brokerOverridesByInstrumentClass: {
        stock: "broker-stock",
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
      "broker-stock",
    ]);
    expect(assignments.listAssignments(result.id)).toEqual([
      { brokerAccountId: "broker-stock", allocatedUsd: 5000 },
    ]);
    expect(routing.listSessionOverrides(result.id)).toEqual([
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

  it("allows any broker with edgar-catalyst (no experience instrument class constraint)", () => {
    const { signalSourcesRepo, sourceId } = insertExperienceSignal(
      db,
      "edgar-catalyst",
    );
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-pm",
      name: "Polymarket Only",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
    });

    // No instrument class constraint on experiences — any broker is accepted
    const result = service.create({
      name: "EDGAR Session",
      objective: "Trade filings",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      subscribedSourceIds: [sourceId],
      brokerAssignments: [{ brokerAccountId: "broker-pm", allocatedUsd: 2500 }],
    });
    expect(result.status).toBe("draft");
  });

  it("creates edgar-catalyst with an Alpaca stock broker", () => {
    const { signalSourcesRepo, sourceId } = insertExperienceSignal(
      db,
      "edgar-catalyst",
    );
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-stock",
      name: "Alpaca Stock",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    const result = service.create({
      name: "EDGAR Stock Session",
      objective: "Trade filings",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      subscribedSourceIds: [sourceId],
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
      ],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["stock"]);
    expect(result.status).toBe("draft");
  });

  it("creates prediction-event-edge with a Polymarket broker", () => {
    const { signalSourcesRepo, sourceId } = insertExperienceSignal(
      db,
      "prediction-event-edge",
    );
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-pm",
      name: "Polymarket Paper",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
    });

    const result = service.create({
      name: "PM Event Session",
      objective: "Trade prediction events",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "prediction-event-edge",
      subscribedSourceIds: [sourceId],
      brokerAssignments: [{ brokerAccountId: "broker-pm", allocatedUsd: 2500 }],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["prediction_market"]);
    expect(result.status).toBe("draft");
  });

  it("rejects prediction-event-edge without a Polymarket broker", () => {
    const { signalSourcesRepo, sourceId } = insertExperienceSignal(
      db,
      "prediction-event-edge",
    );
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    expect(() =>
      service.create({
        name: "Invalid PM Session",
        objective: "Should fail",
        selectionMode: "signal_driven",
        instrumentScope: "",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        experienceId: "prediction-event-edge",
        subscribedSourceIds: [sourceId],
        brokerAssignments: [
          { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
        ],
      }),
    ).toThrowError(/requires at least one Polymarket broker/i);
  });

  it("derives instrument classes from broker in full-universe mode", () => {
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
      instrumentScope: SEARCH_EVERYTHING_SCOPE,
      selectorSettings: { aiPickerEnabled: true },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
      ],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["stock"]);
  });

  it("allows crypto-only broker for edgar-catalyst (no experience instrument class constraint)", () => {
    const { signalSourcesRepo, sourceId } = insertExperienceSignal(
      db,
      "edgar-catalyst",
    );
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-crypto",
      name: "Crypto Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "paper",
    });

    // Experience no longer restricts instrument classes — any broker is accepted
    const result = service.create({
      name: "EDGAR Crypto Broker Session",
      objective: "Crypto broker, EDGAR experience",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      subscribedSourceIds: [sourceId],
      brokerAssignments: [
        { brokerAccountId: "broker-crypto", allocatedUsd: 2500 },
      ],
    });
    expect(result.status).toBe("draft");
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

  it("subscribes a session to multiple signal sources", () => {
    const signalSourcesRepo = new SignalSourcesRepo(db);
    for (const id of ["edgar-source-1", "edgar-source-2"]) {
      signalSourcesRepo.create({
        id,
        type: "edgar_8k",
        name: id,
        description: null,
        enabled: true,
        configJson: "{}",
      });
    }
    const service = createService(db, { signalSourcesRepo });
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    const session = service.create({
      name: "Two Signal Session",
      objective: "Should subscribe to both sources",
      selectionMode: "manual_shortlist",
      instrumentScope: "AAPL",
      selectorSettings: { aiPickerEnabled: true },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
      ],
      subscribedSourceIds: ["edgar-source-1", "edgar-source-2"],
    });

    expect(signalSourcesRepo.subscribedSourceIdsForSession(session.id)).toEqual(
      ["edgar-source-1", "edgar-source-2"],
    );
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

function insertExperienceSignal(
  db: ReturnType<typeof createTestDb>,
  experienceId: string,
): { signalSourcesRepo: SignalSourcesRepo; sourceId: string } {
  const signalSourcesRepo = new SignalSourcesRepo(db);
  const experience = requireExperience(experienceId);
  const signal = experience.signals[0];
  const schedule = experience.schedules?.[0];
  const entry = signal ?? schedule;
  if (!entry) throw new Error(`${experienceId} has no signals or schedules`);
  const sourceId = `${experienceId}/${entry.id}`;
  signalSourcesRepo.create({
    id: sourceId,
    type: signal?.sourceType ?? "timer",
    name: experience.displayName,
    description: null,
    enabled: true,
    experienceId,
    configJson: JSON.stringify({
      signalId: entry.id,
      symbol: entry.symbol,
    }),
  });
  return { signalSourcesRepo, sourceId };
}

function createService(
  db: ReturnType<typeof createTestDb>,
  options?: { signalSourcesRepo?: SignalSourcesRepo },
): SessionWriteService {
  const signalSourcesRepo = options?.signalSourcesRepo;
  const signals = signalSourcesRepo
    ? {
        replaceSessionSubscriptions: (sessionId: string, sourceIds: string[]) =>
          signalSourcesRepo.replaceSessionSubscriptions(sessionId, sourceIds),
        requiresInstrumentScopeForSourceIds: (sourceIds: string[]) => {
          const subscribedSources = sourceIds.flatMap((sourceId) => {
            const source = signalSourcesRepo.get(sourceId);
            return source ? [{ type: source.type }] : [];
          });
          return sessionRequiresInstrumentScope(subscribedSources);
        },
        getSource: (sourceId: string) => signalSourcesRepo.get(sourceId),
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
