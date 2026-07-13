import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { createTestDb } from "../../../db/test-helpers";
import { ProviderAccountsRepo } from "../../../db/repositories/workspace/provider-accounts-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import { SessionStrategyConfigService } from "../session-strategy-config-service";
import { SessionStrategyContextService } from "../session-strategy-context-service";

describe("SessionStrategyContextService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("aggregates strategy config from session_strategy_configs", () => {
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

  it("reads and writes through SessionStrategyConfigService", () => {
    const strategyConfig = new SessionStrategyConfigService(db);
    const service = createService(db, strategyConfig);
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });
    service.saveRiskConfig(session.id, { maxPositionUsd: 900 });

    expect(service.get(session.id).riskConfig.maxPositionUsd).toBe(900);
    expect(strategyConfig.get(session.id).doc.risk.maxPositionUsd).toBe(900);
    expect(strategyConfig.get(session.id).version).toBe(2);
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
    expect(page.selectorSettings.aiPickerEnabled).toBe(true);
  });

  it("persists saves into session_strategy_configs and rejects locked sessions", () => {
    const sessions = new SessionRepo(db);
    const strategyConfig = new SessionStrategyConfigService(db);
    const service = createService(db, strategyConfig);
    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
    });

    const saved = service.saveRules(session.id, {
      tradeRulesMarkdown: "only trade clean catalysts",
    });
    expect(saved.tradeRulesMarkdown).toBe("only trade clean catalysts");
    expect(
      strategyConfig.get(session.id).doc.tradeRules.tradeRulesMarkdown,
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
  strategyConfig = new SessionStrategyConfigService(db),
) {
  return new SessionStrategyContextService({
    sessionRepo: new SessionRepo(db),
    strategyConfig,
    providerAccountsRepo: new ProviderAccountsRepo(db),
    workspacePrefsRepo: new WorkspacePreferencesRepo(db),
  });
}
