import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { createTestDb } from "../../../db/test-helpers";
import { ProviderAccountsRepo } from "../../../db/repositories/workspace/provider-accounts-repo";
import { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import { SessionAiSettingsRepo } from "../../../db/repositories/sessions/session-ai-settings-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/sessions/session-research-posture-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/sessions/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/sessions/session-selector-settings-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/sessions/session-timeframe-config-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/sessions/session-trade-rules-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import { SessionStrategyContextService } from "../session-strategy-context-service";

describe("SessionStrategyContextService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("aggregates strategy config from experience defaults and repos", () => {
    const service = createService(db);
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });
    const context = service.get(session.id);

    expect(context.researchPosture.posturePresetId).toBe("edgar_catalyst");
    expect(context.rules.rulesPresetId).toBe("catalyst_entry");
    expect(context.riskConfig.riskPresetId).toBe("moderate");
    expect(context.timeframe.timeframePresetId).toBe("catalyst");
    expect(context.aiSettings.workerGuidanceMarkdown).toBe("");
  });

  it("prefers persisted strategy JSON over table reads", () => {
    const sessions = new SessionRepo(db);
    const service = createService(db);
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });
    service.saveRiskConfig(session.id, { maxPositionUsd: 900 });

    sessions.updateStrategyConfigJson(
      session.id,
      JSON.stringify({
        version: 5,
        researchPosture: {
          posturePresetId: "edgar_catalyst",
          processingMode: "manual",
          evidenceMode: "balanced",
          catalystMode: "preferred",
          fundamentalStrictness: "balanced",
          postureNotes: "",
        },
        rules: {
          rulesPresetId: "catalyst_entry",
          setupType: "custom",
          sideBias: "both",
          entryStyle: "catalyst",
          exitStyle: "fixed_pct",
          scalingMode: "single_entry",
          tradeRulesMarkdown: "",
          ruleNotes: "",
        },
        riskConfig: {
          maxPositionUsd: 1200,
          stopLossPct: 2,
          takeProfitPct: 4,
          stopLossType: "fixed_pct",
          atrStopMultiplier: null,
          kellyFraction: 0.25,
          predictionEdgeThreshold: 0.08,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          maxConcurrentTrades: 2,
          maxConsecutiveLosers: 3,
          volatilityHaltMaxSpreadPct: 1.5,
          dailyLossLimitUsd: 250,
          profitTargetUsd: 500,
          maxAiSpendUsd: 25,
          maxDataSpendUsd: 10,
          humanApprovalRequired: false,
        },
        timeframe: {
          primaryTradingTimeframe: "1d",
          holdingStyle: "swing",
          targetHoldDays: 5,
          maxHoldDays: 10,
          timeframeNotes: "",
        },
        aiSettings: { workerGuidanceMarkdown: "from-json" },
        presetIds: {
          posturePresetId: "edgar_catalyst",
          rulesPresetId: "catalyst_entry",
          riskPresetId: "moderate",
          timeframePresetId: "catalyst",
        },
      }),
    );

    expect(service.get(session.id).riskConfig.maxPositionUsd).toBe(1200);
    expect(service.get(session.id).aiSettings.workerGuidanceMarkdown).toBe(
      "from-json",
    );
  });

  it("returns strategy page data with workspace defaults and AI phases", () => {
    const service = createService(db);
    const providers = new ProviderAccountsRepo(db);
    providers.upsert({
      id: "provider-openrouter",
      name: "OpenRouter",
      category: "ai",
      providerType: "openrouter",
      secretRef: "provider:provider-openrouter",
      metadataJson: null,
      isConfigured: true,
    });
    new WorkspacePreferencesRepo(db).update({
      defaultModelProviderKey: "provider-openrouter",
      defaultModelModelId: "google/gemma-4-31b-it",
      defaultSearchProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
    });
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });
    const page = service.getPageData(session.id);

    expect(page.sessionStatus).toBe("draft");
    expect(page.selectionMode).toBe("manual_shortlist");
    expect(page.workspaceDefaultModelProviderKey).toBe("provider-openrouter");
    expect(page.workspaceDefaultSearchProviderId).toBe(
      BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
    );
    expect(page.providers.map((provider) => provider.id)).toEqual([
      "provider-openrouter",
    ]);
    expect(page.aiPhases).toHaveLength(5);
    expect(page.selectorSettings).toEqual(
      new SessionSelectorSettingsRepo(db).get(session.id),
    );
  });

  it("persists saves back into strategy JSON and rejects locked sessions", () => {
    const sessions = new SessionRepo(db);
    const service = createService(db);
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });

    const saved = service.saveRules(session.id, {
      tradeRulesMarkdown: "only trade clean catalysts",
    });
    expect(saved.tradeRulesMarkdown).toBe("only trade clean catalysts");
    expect(
      JSON.parse(sessions.getStrategyConfigJson(session.id) ?? "{}").rules
        .tradeRulesMarkdown,
    ).toBe("only trade clean catalysts");

    sessions.setStatus("active", session.id);
    expect(() =>
      service.saveRiskConfig(session.id, { maxPositionUsd: 100 }),
    ).toThrow(/stop this session/i);
  });

  it("allows catalyst postures regardless of signal source type (check removed in Phase 8)", () => {
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });
    const service = createService(db);

    // In V2, source-type compatibility is managed at the experience-catalog level;
    // the legacy subscription-based check is removed.
    expect(() =>
      service.saveResearchPosture(session.id, {
        catalystMode: "required",
        processingMode: "catalyst",
      }),
    ).not.toThrow();
  });
});

function createService(
  db: ReturnType<typeof createTestDb>,
) {
  return new SessionStrategyContextService({
    sessionRepo: new SessionRepo(db),
    researchPostureRepo: new SessionResearchPostureRepo(db),
    rulesRepo: new SessionTradeRulesRepo(db),
    riskRepo: new SessionRiskConfigRepo(db),
    timeframeRepo: new SessionTimeframeConfigRepo(db),
    aiSettingsRepo: new SessionAiSettingsRepo(db),
    selectorSettingsRepo: new SessionSelectorSettingsRepo(db),
    providerAccountsRepo: new ProviderAccountsRepo(db),
    workspacePrefsRepo: new WorkspacePreferencesRepo(db),
    sessionAiPhasesRepo: new SessionAiPhasesRepo(db),
  });
}
