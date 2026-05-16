import {
  buildTradeRulesMarkdown,
  buildStrategySnapshot,
  type AgentRole,
  type SessionStrategyContext,
  type StrategySnapshot,
} from "@electron/shared/domain";
import { renderAiRoleProfileMarkdown } from "@electron/shared/ai/ai-role-profile";

const MAX_NOTES_CHARS = 500;
const MAX_BRIEF_PROMPT_CHARS = 600;
const MAX_ROLE_PROFILE_JSON_CHARS = 700;

export interface StrategyPromptContext {
  prompt: string;
  snapshot: StrategySnapshot;
}

export function buildStrategyPromptContext(
  context: SessionStrategyContext,
  options?: { role?: AgentRole },
): StrategyPromptContext {
  const snapshot = buildStrategySnapshot({
    ...context,
    researchPosture: {
      ...context.researchPosture,
      postureNotes: truncate(context.researchPosture.postureNotes, MAX_NOTES_CHARS),
    },
    rules: {
      ...context.rules,
      tradeRulesMarkdown: context.rules.tradeRulesMarkdown.trim() || buildTradeRulesMarkdown(context.rules),
      ruleNotes: truncate(context.rules.ruleNotes, MAX_NOTES_CHARS),
    },
    timeframe: {
      ...context.timeframe,
      timeframeNotes: truncate(context.timeframe.timeframeNotes, MAX_NOTES_CHARS),
    },
  });

  const roleLines = options?.role != null ? compactRoleProfile(snapshot, options.role) : [];

  const lines = [
    "## Session research posture (authoritative)",
    `- Posture preset: ${snapshot.researchPosture.posturePresetId}`,
    `- Discovery mode: ${snapshot.researchPosture.discoveryMode}`,
    `- Evidence mode: ${snapshot.researchPosture.evidenceMode}`,
    `- Catalyst posture: ${snapshot.researchPosture.catalystMode}`,
    `- Fundamental strictness: ${snapshot.researchPosture.fundamentalStrictness}`,
    snapshot.researchPosture.postureNotes.trim()
      ? `- Posture notes: ${snapshot.researchPosture.postureNotes.trim()}`
      : null,
    "",
    "## Session trade rules (authoritative)",
    `- Rules preset: ${snapshot.rules.rulesPresetId}`,
    `- Setup type: ${snapshot.rules.setupType}`,
    `- Side bias: ${snapshot.rules.sideBias}`,
    `- Entry style: ${snapshot.rules.entryStyle}`,
    `- Exit style: ${snapshot.rules.exitStyle}`,
    `- Scaling mode: ${snapshot.rules.scalingMode}`,
    snapshot.rules.tradeRulesMarkdown.trim()
      ? `- Trade rules markdown: ${truncate(snapshot.rules.tradeRulesMarkdown.trim(), MAX_BRIEF_PROMPT_CHARS)}`
      : null,
    snapshot.rules.ruleNotes.trim()
      ? `- Rule notes: ${snapshot.rules.ruleNotes.trim()}`
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
    ...roleLines,
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

/** Only added when `buildStrategyPromptContext(..., { role })` — i.e. prompt pack runs. */
function compactRoleProfile(snapshot: StrategySnapshot, role: AgentRole): string[] {
  const p = snapshot.aiRoleProfiles.find((x) => x.role === role);
  if (!p) {
    return ["", "## Role profile", `- ${role}: (no row)`];
  }
  return ["", "## Role profile", ...renderAiRoleProfileMarkdown(p.profileJson, { maxAdditionalJsonChars: MAX_ROLE_PROFILE_JSON_CHARS })];
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}
