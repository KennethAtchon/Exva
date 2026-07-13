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
    const service = createService(db);
    insertBroker(db, {
      id: "broker-pm",
      name: "Polymarket Only",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
    });

    // edgar-catalyst is event-driven — empty instrumentScope is valid
    const result = service.create({
      name: "EDGAR Session",
      objective: "Trade filings",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [{ brokerAccountId: "broker-pm", allocatedUsd: 2500 }],
    });
    expect(result.status).toBe("draft");
  });

  it("creates edgar-catalyst with an Alpaca stock broker", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Alpaca Stock",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    // edgar-catalyst is event-driven — empty instrumentScope is valid
    const result = service.create({
      name: "EDGAR Stock Session",
      objective: "Trade filings",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 2500 },
      ],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["stock"]);
    expect(result.status).toBe("draft");
  });

  it("creates prediction-event-edge with a Polymarket broker", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-pm",
      name: "Polymarket Paper",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
    });

    // prediction-event-edge is event-driven — empty instrumentScope is valid
    const result = service.create({
      name: "PM Event Session",
      objective: "Trade prediction events",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "prediction-event-edge",
      brokerAssignments: [{ brokerAccountId: "broker-pm", allocatedUsd: 2500 }],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["prediction_market"]);
    expect(result.status).toBe("draft");
  });

  it("rejects prediction-event-edge without a Polymarket broker", () => {
    const service = createService(db);
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
    const service = createService(db);
    insertBroker(db, {
      id: "broker-crypto",
      name: "Crypto Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "paper",
    });

    const result = service.create({
      name: "EDGAR Crypto Broker Session",
      objective: "Crypto broker, EDGAR experience",
      selectionMode: "signal_driven",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [
        { brokerAccountId: "broker-crypto", allocatedUsd: 2500 },
      ],
    });
    expect(result.status).toBe("draft");
  });

  it("allows empty instrument scope for event-driven (listener) experiences", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    // edgar-catalyst declares signalSourceTypes → event-driven → empty scope is valid
    const result = service.create({
      name: "EDGAR Listener Session",
      objective: "React to filings automatically",
      selectionMode: "manual_shortlist",
      instrumentScope: "",
      selectorSettings: { aiPickerEnabled: true },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [
        { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
      ],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentScope).toBe("");
  });

  it("rejects empty instrument scope for scan-hit experiences that require a scope", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    // rules-mean-reversion has no signalSourceTypes (scan_hit) → scope is required
    expect(() =>
      service.create({
        name: "Rules No-Scope Session",
        objective: "Needs tickers",
        selectionMode: "manual_shortlist",
        instrumentScope: "",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        experienceId: "rules-mean-reversion",
        brokerAssignments: [
          { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
        ],
      }),
    ).toThrowError(/instrument scope cannot be empty/i);
  });
});

function createService(
  db: ReturnType<typeof createTestDb>,
): SessionWriteService {
  return new SessionWriteService({
    sessions: new SessionRepo(db),
    events: new EventsRepo(db),
    selectorSettings: new SessionSelectorSettingsRepo(db),
    assignments: new SessionBrokerAssignmentsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
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
