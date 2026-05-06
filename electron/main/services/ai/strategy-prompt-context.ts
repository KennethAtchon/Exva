import {
  buildStrategyBriefMarkdown,
  buildStrategySnapshot,
  type SessionStrategyContext,
  type StrategySnapshot,
  STRATEGY_BRIEF_MARKDOWN_MAX_CHARS,
} from "@electron/shared/domain";

const MAX_NOTES_CHARS = 500;
const MAX_BRIEF_PROMPT_CHARS = 600;

export interface StrategyPromptContext {
  prompt: string;
  snapshot: StrategySnapshot;
}

export function buildStrategyPromptContext(context: SessionStrategyContext): StrategyPromptContext {
  const snapshot = buildStrategySnapshot({
    ...context,
    profile: {
      ...context.profile,
      strategyBriefMarkdown: context.profile.strategyBriefMarkdown.trim() || buildStrategyBriefMarkdown(context),
    },
    timeframe: {
      ...context.timeframe,
      timeframeNotes: truncate(context.timeframe.timeframeNotes, MAX_NOTES_CHARS),
    },
  });

  const lines = [
    "## Session strategy (authoritative)",
    `- Strategy type: ${snapshot.profile.strategyType}`,
    `- Side bias: ${snapshot.profile.sideBias}`,
    `- Entry style: ${snapshot.profile.entryStyle}`,
    `- Exit style: ${snapshot.profile.exitStyle}`,
    `- Scaling mode: ${snapshot.profile.scalingMode}`,
    snapshot.profile.strategyBriefMarkdown.trim()
      ? `- Strategy brief: ${truncate(snapshot.profile.strategyBriefMarkdown.trim(), MAX_BRIEF_PROMPT_CHARS)}`
      : null,
    snapshot.profile.customInstructions.trim()
      ? `- Custom instructions: ${snapshot.profile.customInstructions.trim()}`
      : null,
    "",
    "## Session risk (authoritative)",
    `- Max position USD: ${snapshot.riskConfig.maxPositionUsd}`,
    `- Stop loss type: ${snapshot.riskConfig.stopLossType}`,
    snapshot.riskConfig.stopLossPct != null ? `- Stop loss pct: ${snapshot.riskConfig.stopLossPct}` : null,
    snapshot.riskConfig.takeProfitPct != null ? `- Take profit pct: ${snapshot.riskConfig.takeProfitPct}` : null,
    snapshot.riskConfig.atrStopMultiplier != null
      ? `- ATR stop multiplier: ${snapshot.riskConfig.atrStopMultiplier}`
      : null,
    snapshot.riskConfig.maxExposureUsd != null ? `- Max exposure USD: ${snapshot.riskConfig.maxExposureUsd}` : null,
    `- Kelly fraction: ${snapshot.riskConfig.kellyFraction}`,
    `- Prediction edge threshold: ${snapshot.riskConfig.predictionEdgeThreshold}`,
    `- Wait-for-open threshold: ${snapshot.riskConfig.waitForOpenThreshold}`,
    `- Max concurrent trades: ${snapshot.riskConfig.maxConcurrentTrades}`,
    `- Daily loss limit USD: ${snapshot.riskConfig.dailyLossLimitUsd}`,
    `- Profit target USD: ${snapshot.riskConfig.profitTargetUsd}`,
    `- Max AI spend USD: ${snapshot.riskConfig.maxAiSpendUsd}`,
    `- Max data spend USD: ${snapshot.riskConfig.maxDataSpendUsd}`,
    `- Human approval required: ${snapshot.riskConfig.humanApprovalRequired ? "yes" : "no"}`,
    "",
    "## Session trading horizon (authoritative)",
    `- Primary timeframe: ${snapshot.timeframe.primaryTradingTimeframe}`,
    `- Holding style: ${snapshot.timeframe.holdingStyle}`,
    snapshot.timeframe.targetHoldDays != null ? `- Target hold: ~${snapshot.timeframe.targetHoldDays} calendar days` : null,
    snapshot.timeframe.maxHoldDays != null ? `- Max hold: ${snapshot.timeframe.maxHoldDays} calendar days` : null,
    snapshot.timeframe.timeframeNotes.trim() ? `- Notes: ${snapshot.timeframe.timeframeNotes.trim()}` : null,
  ].filter((line): line is string => line != null);

  return {
    snapshot,
    prompt: lines.join("\n"),
  };
}

export function prependStrategyContextToUserPrompt(context: SessionStrategyContext, userPrompt: string): StrategyPromptContext {
  const built = buildStrategyPromptContext(context);
  return {
    snapshot: built.snapshot,
    prompt: `${built.prompt}\n\n${userPrompt}`,
  };
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}
