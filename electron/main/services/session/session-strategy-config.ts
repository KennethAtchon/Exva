import type {
  SessionAiSettings,
  SessionResearchPosture,
  SessionRiskConfig,
  SessionStrategyContext,
  SessionTimeframeConfig,
  SessionTradeRules,
  StrategySnapshot,
} from "@electron/shared/domain/session";
import {
  buildStrategySnapshot,
  emptySessionAiSettings,
  isOffHoursTrading,
} from "@electron/shared/domain/session";
import { safeJsonParse } from "../infra/safe-json-parse";

export type SessionStrategyConfigJson = StrategySnapshot & {
  aiSettings: Pick<SessionAiSettings, "workerGuidanceMarkdown">;
  presetIds: {
    posturePresetId: SessionResearchPosture["posturePresetId"];
    rulesPresetId: SessionTradeRules["rulesPresetId"];
    riskPresetId: SessionRiskConfig["riskPresetId"];
    timeframePresetId: SessionTimeframeConfig["timeframePresetId"];
  };
};

export function buildSessionStrategyConfigJson(
  context: SessionStrategyContext,
): SessionStrategyConfigJson {
  const snapshot = buildStrategySnapshot(context);
  return {
    ...snapshot,
    aiSettings: {
      workerGuidanceMarkdown: context.aiSettings.workerGuidanceMarkdown,
    },
    presetIds: {
      posturePresetId: context.researchPosture.posturePresetId,
      rulesPresetId: context.rules.rulesPresetId,
      riskPresetId: context.riskConfig.riskPresetId,
      timeframePresetId: context.timeframe.timeframePresetId,
    },
  };
}

export function parseSessionStrategyConfigJson(
  sessionId: string,
  raw: string | null | undefined,
  updatedAt: string,
): SessionStrategyContext | null {
  if (!raw?.trim()) return null;
  const parsed = safeJsonParse<SessionStrategyConfigJson>(
    raw,
    undefined,
    "session-strategy-config",
  );
  if (!parsed || parsed.version !== 5) return null;
  return strategyConfigToContext(sessionId, parsed, updatedAt);
}

export function strategyConfigToContext(
  sessionId: string,
  config: SessionStrategyConfigJson,
  updatedAt: string,
): SessionStrategyContext {
  return {
    researchPosture: {
      sessionId,
      posturePresetId:
        config.presetIds?.posturePresetId ??
        config.researchPosture.posturePresetId,
      processingMode: config.researchPosture.processingMode,
      evidenceMode: config.researchPosture.evidenceMode,
      catalystMode: config.researchPosture.catalystMode,
      fundamentalStrictness: config.researchPosture.fundamentalStrictness,
      postureNotes: config.researchPosture.postureNotes,
      updatedAt,
    },
    rules: {
      sessionId,
      rulesPresetId:
        config.presetIds?.rulesPresetId ?? config.rules.rulesPresetId,
      setupType: config.rules.setupType,
      sideBias: config.rules.sideBias,
      entryStyle: config.rules.entryStyle,
      exitStyle: config.rules.exitStyle,
      scalingMode: config.rules.scalingMode,
      tradeRulesMarkdown: config.rules.tradeRulesMarkdown,
      ruleNotes: config.rules.ruleNotes,
      updatedAt,
    },
    riskConfig: {
      sessionId,
      riskPresetId:
        config.presetIds?.riskPresetId ??
        ("moderate" as SessionRiskConfig["riskPresetId"]),
      offHoursTrading: (() => {
        const raw = config.riskConfig.offHoursTrading ?? "disabled";
        return isOffHoursTrading(raw) ? raw : "disabled";
      })(),
      maxPositionUsd: config.riskConfig.maxPositionUsd,
      stopLossPct: config.riskConfig.stopLossPct,
      takeProfitPct: config.riskConfig.takeProfitPct,
      stopLossType: config.riskConfig.stopLossType,
      atrStopMultiplier: config.riskConfig.atrStopMultiplier,
      kellyFraction: config.riskConfig.kellyFraction,
      predictionEdgeThreshold: config.riskConfig.predictionEdgeThreshold,
      maxExposureUsd: config.riskConfig.maxExposureUsd,
      waitForOpenThreshold: config.riskConfig.waitForOpenThreshold,
      maxConcurrentTrades: config.riskConfig.maxConcurrentTrades,
      maxConsecutiveLosers: config.riskConfig.maxConsecutiveLosers,
      volatilityHaltMaxSpreadPct: config.riskConfig.volatilityHaltMaxSpreadPct,
      dailyLossLimitUsd: config.riskConfig.dailyLossLimitUsd,
      profitTargetUsd: config.riskConfig.profitTargetUsd,
      maxAiSpendUsd: config.riskConfig.maxAiSpendUsd,
      maxDataSpendUsd: config.riskConfig.maxDataSpendUsd,
      humanApprovalRequired: config.riskConfig.humanApprovalRequired,
      calendarBlackoutHours: config.riskConfig.calendarBlackoutHours ?? 24,
      eventTypedExperience: config.riskConfig.eventTypedExperience ?? false,
      updatedAt,
    },
    timeframe: {
      sessionId,
      timeframePresetId:
        config.presetIds?.timeframePresetId ??
        ("swing" as SessionTimeframeConfig["timeframePresetId"]),
      primaryTradingTimeframe: config.timeframe.primaryTradingTimeframe,
      holdingStyle: config.timeframe.holdingStyle,
      targetHoldDays: config.timeframe.targetHoldDays,
      maxHoldDays: config.timeframe.maxHoldDays,
      timeframeNotes: config.timeframe.timeframeNotes,
      updatedAt,
    },
    aiSettings: {
      ...emptySessionAiSettings(sessionId, updatedAt),
      workerGuidanceMarkdown: config.aiSettings.workerGuidanceMarkdown,
    },
  };
}

export function patchSessionStrategyConfigJson(
  current: SessionStrategyConfigJson,
  patch: Partial<SessionStrategyContext>,
): SessionStrategyConfigJson {
  const ctx = strategyConfigToContext(
    "patch",
    current,
    new Date().toISOString(),
  );
  const next: SessionStrategyContext = {
    researchPosture: patch.researchPosture
      ? { ...ctx.researchPosture, ...patch.researchPosture }
      : ctx.researchPosture,
    rules: patch.rules ? { ...ctx.rules, ...patch.rules } : ctx.rules,
    riskConfig: patch.riskConfig
      ? { ...ctx.riskConfig, ...patch.riskConfig }
      : ctx.riskConfig,
    timeframe: patch.timeframe
      ? { ...ctx.timeframe, ...patch.timeframe }
      : ctx.timeframe,
    aiSettings: patch.aiSettings
      ? { ...ctx.aiSettings, ...patch.aiSettings }
      : ctx.aiSettings,
  };
  return buildSessionStrategyConfigJson(next);
}
