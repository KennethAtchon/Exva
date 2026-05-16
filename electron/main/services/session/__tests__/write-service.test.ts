import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/session-instrument-classes";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { EventsRepo } from "../../../db/repositories/events-repo";
import { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/session-research-posture-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/session-selector-settings-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/session-timeframe-config-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/session-trade-rules-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
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
      capitalLimitUsd: 5000,
      executionMode: "live_allowed",
      brokerAccountIds: ["broker-stock", "broker-crypto"],
      brokerOverridesByInstrumentClass: {
        stock: "broker-stock",
        crypto: "broker-crypto",
      },
    });

    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const routing = new BrokerRoutingRepo(db);
    const selectorSettings = new SessionSelectorSettingsRepo(db);
    const aiRoles = new SessionAiRolesRepo(db).listBySession(result.id);
    const researchPosture = new SessionResearchPostureRepo(db).get(result.id);
    const tradeRules = new SessionTradeRulesRepo(db).get(result.id);
    const riskConfig = new SessionRiskConfigRepo(db).get(result.id);
    const timeframe = new SessionTimeframeConfigRepo(db).get(result.id);

    expect(result.status).toBe("draft");
    expect(sessions.getFocusedSessionId()).toBe(result.id);
    expect(assignments.listBrokerAccountIds(result.id)).toEqual(["broker-crypto", "broker-stock"]);
    expect(routing.listSessionOverrides(result.id)).toEqual([
      { sessionId: result.id, instrumentClass: "crypto", brokerAccountId: "broker-crypto" },
      { sessionId: result.id, instrumentClass: "stock", brokerAccountId: "broker-stock" },
    ]);
    expect(selectorSettings.get(result.id).aiPickerEnabled).toBe(false);
    expect(aiRoles).toHaveLength(5);
    expect(aiRoles.every((role) => role.providerKey === "provider-openrouter")).toBe(true);
    expect(aiRoles.every((role) => role.modelId === "google/gemma-4-31b-it")).toBe(true);
    expect(researchPosture.posturePresetId).toBe("trend_hunt");
    expect(tradeRules.rulesPresetId).toBe("breakout_long");
    expect(riskConfig.riskPresetId).toBe("moderate");
    expect(timeframe.timeframePresetId).toBe("swing");
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
      capitalLimitUsd: 1000,
      executionMode: "paper_only",
      brokerAccountIds: ["broker-stock"],
    });

    const aiRoles = new SessionAiRolesRepo(db).listBySession(result.id);
    expect(aiRoles).toHaveLength(5);
    expect(aiRoles.every((role) => role.providerKey === "")).toBe(true);
    expect(aiRoles.every((role) => role.modelId === "")).toBe(true);
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
        capitalLimitUsd: 2500,
        executionMode: "paper_only",
        brokerAccountIds: ["broker-stock"],
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
      capitalLimitUsd: 2500,
      executionMode: "paper_only",
      brokerAccountIds: ["broker-stock", "broker-crypto"],
    });

    const session = new SessionRepo(db).requireById(result.id);
    expect(session.instrumentClasses).toEqual(["stock", "crypto"]);
  });
});

function createService(db: ReturnType<typeof createTestDb>): SessionWriteService {
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
    supportedInstrumentClasses: Array<"stock" | "crypto" | "futures" | "prediction_market">;
    mode: "paper" | "live";
  },
): void {
  new BrokerAccountsRepo(db).insert({
    ...input,
    secretRef: `broker:${input.id}`,
  });
}
