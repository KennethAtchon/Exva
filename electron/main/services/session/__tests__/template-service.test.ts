import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { ProviderAccountsRepo } from "../../../db/repositories/provider-accounts-repo";
import { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/session-selector-settings-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/session-trade-rules-repo";
import { SessionTemplatesRepo } from "../../../db/repositories/session-templates-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/session-timeframe-config-repo";
import { SessionAiRoleProfileRepo } from "../../../db/repositories/session-ai-role-profile-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/session-research-posture-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import { SessionStrategyContextService } from "../session-strategy-context-service";
import { SessionTemplateService } from "../template-service";

describe("SessionTemplateService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("clears missing provider and broker references when applying a template", () => {
    const templates = new SessionTemplatesRepo(db);
    const { id } = templates.create({
      name: "Template A",
      payload: {
        version: 1,
        identity: {
          objective: "Trade growth",
          selectionMode: "manual_shortlist",
          instrumentClasses: ["stock"],
          instrumentScope: "NVDA",
          executionMode: "paper_only",
          defaultSearchProviderId: null,
        },
        selectorSettings: { aiPickerEnabled: false },
        strategyContext: {
          researchPosture: {
            sessionId: "s1",
            posturePresetId: "custom",
            discoveryMode: "custom",
            evidenceMode: "balanced",
            catalystMode: "preferred",
            fundamentalStrictness: "balanced",
            postureNotes: "",
            updatedAt: new Date().toISOString(),
          },
          aiRoleProfiles: [],
          rules: {
            sessionId: "s1",
            rulesPresetId: "custom",
            setupType: "custom",
            sideBias: "both",
            entryStyle: "breakout",
            exitStyle: "fixed_pct",
            scalingMode: "single_entry",
            tradeRulesMarkdown: "",
            ruleNotes: "",
            updatedAt: new Date().toISOString(),
          },
          riskConfig: {
            sessionId: "s1",
            riskPresetId: "custom" as const,
            maxPositionUsd: 500,
            stopLossPct: 2,
            takeProfitPct: 4,
            stopLossType: "fixed_pct",
            atrStopMultiplier: null,
            kellyFraction: 0.25,
            predictionEdgeThreshold: 0.08,
            maxExposureUsd: null,
            waitForOpenThreshold: 0.8,
            maxConcurrentTrades: 3,
            dailyLossLimitUsd: 200,
            profitTargetUsd: 1000,
            maxAiSpendUsd: 5,
            maxDataSpendUsd: 5,
            humanApprovalRequired: false,
            updatedAt: new Date().toISOString(),
          },
          timeframe: {
            sessionId: "s1",
            timeframePresetId: "custom" as const,
            primaryTradingTimeframe: "1d",
            holdingStyle: "multi_day_swing",
            targetHoldDays: null,
            maxHoldDays: null,
            timeframeNotes: "",
            updatedAt: new Date().toISOString(),
          },
        },
        strategy: {
          strategyProfile: "custom",
          maxPositionUsd: 500,
          stopLossPct: 2,
          takeProfitPct: 4,
          maxConcurrentTrades: 3,
          researchDepth: "balanced",
          dailyLossLimitUsd: 200,
          profitTargetUsd: 1000,
          maxAiSpendUsd: 5,
          humanApprovalRequired: false,
          primaryTradingTimeframe: "1d",
          holdingStyle: "multi_day_swing",
          targetHoldDays: null,
          maxHoldDays: null,
          timeframeNotes: "",
        },
        aiRoles: [
          {
            role: "analyst_technical",
            providerKey: "missing-provider",
            modelId: "claude-sonnet-4-6",
            temperature: 0.7,
            maxTokens: 8192,
            promptSource: "default",
            promptMarkdown: "",
            promptAssetPath: null,
          },
        ],
        brokerAssignments: [{ brokerAccountId: "missing-broker", allocatedUsd: 5000 }],
        brokerOverridesByInstrumentClass: { stock: "missing-broker" },
      },
    });

    const service = createTemplateService(db);
    const result = service.apply(id);

    expect(result.payload.aiRoles[0]?.providerKey).toBe("");
    expect(result.payload.brokerAssignments[0]?.brokerAccountId).toBe("");
    expect(result.payload.brokerOverridesByInstrumentClass).toEqual({});
    expect(result.clearedFields).toEqual([
      "aiRoles[0].providerKey",
      "brokerAssignments[0]",
      "brokerOverridesByInstrumentClass.stock",
    ]);
  });

  it("builds a reusable payload snapshot from a session", () => {
    new ProviderAccountsRepo(db).upsert({
      id: "search-1",
      name: "Search Provider",
      category: "search",
      providerType: "brave",
      secretRef: "provider:search-1",
      metadataJson: null,
      isConfigured: true,
    });
    const sessions = new SessionRepo(db);
    const sessionId = sessions.create({
      name: "Template Source",
      objective: "Trade leaders",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock", "crypto"],
      instrumentScope: "NVDA,BTC-USD",
      executionMode: "live_allowed",
      defaultSearchProviderId: "search-1",
    }).id;

    new ProviderAccountsRepo(db).upsert({
      id: "provider-anthropic",
      name: "Anthropic",
      category: "ai",
      providerType: "anthropic",
      secretRef: "provider:provider-anthropic",
      metadataJson: null,
      isConfigured: true,
    });
    new BrokerAccountsRepo(db).insert({
      id: "broker-stock",
      name: "Stock Broker",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:broker-stock",
    });
    new BrokerAccountsRepo(db).insert({
      id: "broker-crypto",
      name: "Crypto Broker",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "live",
      secretRef: "broker:broker-crypto",
    });
    new SessionBrokerAssignmentsRepo(db).replaceAssignments(sessionId, [
      { brokerAccountId: "broker-stock", allocatedUsd: 3000 },
      { brokerAccountId: "broker-crypto", allocatedUsd: 5000 },
    ]);
    new BrokerRoutingRepo(db).upsertSessionOverrides(sessionId, [
      { instrumentClass: "stock", brokerAccountId: "broker-stock" },
      { instrumentClass: "crypto", brokerAccountId: "broker-crypto" },
    ]);

    const service = createTemplateService(db);
    const payload = service.buildPayloadFromSession(sessionId);

    expect(payload.identity.executionMode).toBe("live_allowed");
    expect(payload.identity.instrumentClasses).toEqual(["stock", "crypto"]);
    expect(payload.brokerAssignments).toEqual([
      { brokerAccountId: "broker-crypto", allocatedUsd: 5000 },
      { brokerAccountId: "broker-stock", allocatedUsd: 3000 },
    ]);
    expect(payload.brokerOverridesByInstrumentClass).toEqual({
      crypto: "broker-crypto",
      stock: "broker-stock",
    });
    expect(payload.aiRoles.length).toBeGreaterThan(0);
  });
});

function createTemplateService(db: ReturnType<typeof createTestDb>): SessionTemplateService {
  const sessions = new SessionRepo(db);
  return new SessionTemplateService({
    templates: new SessionTemplatesRepo(db),
    sessions,
    strategyContext: new SessionStrategyContextService({
      sessionRepo: sessions,
      researchPostureRepo: new SessionResearchPostureRepo(db),
      aiRoleProfileRepo: new SessionAiRoleProfileRepo(db),
      rulesRepo: new SessionTradeRulesRepo(db),
      riskRepo: new SessionRiskConfigRepo(db),
      timeframeRepo: new SessionTimeframeConfigRepo(db),
      aiRolesRepo: new SessionAiRolesRepo(db),
      selectorSettingsRepo: new SessionSelectorSettingsRepo(db),
      providerAccountsRepo: new ProviderAccountsRepo(db),
      workspacePrefsRepo: new WorkspacePreferencesRepo(db),
      promptAssetLoader: {
        load: () => "prompt",
        assetPath: () => "/prompt.md",
      } as never,
    }),
    aiRoles: new SessionAiRolesRepo(db),
    selectorSettings: new SessionSelectorSettingsRepo(db),
    brokerAssignments: new SessionBrokerAssignmentsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    providerAccounts: new ProviderAccountsRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
  });
}
