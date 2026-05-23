import type {
  StrategyContextField,
  WorkerStrategyContextRequest,
} from "@electron/shared/ai/ai-phase";
import {
  buildTradeRulesMarkdown,
  buildStrategySnapshot,
  type SessionStrategyContext,
  type StrategySnapshot,
} from "@electron/shared/domain";

const MAX_NOTES_CHARS = 500;
const MAX_BRIEF_PROMPT_CHARS = 600;

export interface StrategyPromptContext {
  prompt: string;
  snapshot: StrategySnapshot;
}

type WorkerStrategyFactSection = {
  field: StrategyContextField;
  render: (context: SessionStrategyContext) => Array<string | null>;
};

const WORKER_STRATEGY_FACT_SECTIONS: readonly WorkerStrategyFactSection[] = [
  {
    field: "identity",
    render: ({ researchPosture, rules, riskConfig, timeframe }) => [
      `Posture preset: ${researchPosture.posturePresetId}`,
      `Rules preset: ${rules.rulesPresetId}`,
      `Risk preset: ${riskConfig.riskPresetId}`,
      `Timeframe preset: ${timeframe.timeframePresetId}`,
    ],
  },
  {
    field: "researchPosture",
    render: ({ researchPosture }) => [
      `Discovery: ${researchPosture.discoveryMode}`,
      `Evidence: ${researchPosture.evidenceMode}`,
      `Catalyst: ${researchPosture.catalystMode}`,
      `Fundamental strictness: ${researchPosture.fundamentalStrictness}`,
    ],
  },
  {
    field: "tradeRules",
    render: ({ rules }) => [
      `Setup: ${rules.setupType}`,
      `Side bias: ${rules.sideBias}`,
      `Entry: ${rules.entryStyle}`,
      `Exit: ${rules.exitStyle}`,
      `Scaling: ${rules.scalingMode}`,
    ],
  },
  {
    field: "riskLimits",
    render: ({ riskConfig }) => [
      `Max position USD: ${riskConfig.maxPositionUsd}`,
      `Max exposure USD: ${riskConfig.maxExposureUsd ?? "none"}`,
      `Max concurrent: ${riskConfig.maxConcurrentTrades}`,
      `Stop loss type: ${riskConfig.stopLossType}`,
      `Wait-for-open threshold: ${riskConfig.waitForOpenThreshold}`,
      `Human approval: ${riskConfig.humanApprovalRequired ? "yes" : "no"}`,
      renderNullable("Stop loss pct", riskConfig.stopLossPct),
      renderNullable("Take profit pct", riskConfig.takeProfitPct),
    ],
  },
  {
    field: "timeframe",
    render: ({ timeframe }) => [
      `Horizon: ${timeframe.primaryTradingTimeframe} (${timeframe.holdingStyle})`,
      renderNullable("Target hold days", timeframe.targetHoldDays),
      renderNullable("Max hold days", timeframe.maxHoldDays),
    ],
  },
];

export function buildStrategyPromptContext(
  context: SessionStrategyContext,
): StrategyPromptContext {
  const snapshot = buildStrategySnapshot({
    ...context,
    researchPosture: {
      ...context.researchPosture,
      postureNotes: truncate(
        context.researchPosture.postureNotes,
        MAX_NOTES_CHARS,
      ),
    },
    rules: {
      ...context.rules,
      tradeRulesMarkdown:
        context.rules.tradeRulesMarkdown.trim() ||
        buildTradeRulesMarkdown(context.rules),
      ruleNotes: truncate(context.rules.ruleNotes, MAX_NOTES_CHARS),
    },
    timeframe: {
      ...context.timeframe,
      timeframeNotes: truncate(
        context.timeframe.timeframeNotes,
        MAX_NOTES_CHARS,
      ),
    },
  });

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
    snapshot.riskConfig.stopLossPct != null
      ? `- Stop loss pct: ${snapshot.riskConfig.stopLossPct}`
      : null,
    snapshot.riskConfig.takeProfitPct != null
      ? `- Take profit pct: ${snapshot.riskConfig.takeProfitPct}`
      : null,
    snapshot.riskConfig.atrStopMultiplier != null
      ? `- ATR stop multiplier: ${snapshot.riskConfig.atrStopMultiplier}`
      : null,
    snapshot.riskConfig.maxExposureUsd != null
      ? `- Max exposure USD: ${snapshot.riskConfig.maxExposureUsd}`
      : null,
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
    snapshot.timeframe.targetHoldDays != null
      ? `- Target hold: ~${snapshot.timeframe.targetHoldDays} calendar days`
      : null,
    snapshot.timeframe.maxHoldDays != null
      ? `- Max hold: ${snapshot.timeframe.maxHoldDays} calendar days`
      : null,
    snapshot.timeframe.timeframeNotes.trim()
      ? `- Notes: ${snapshot.timeframe.timeframeNotes.trim()}`
      : null,
  ].filter((line): line is string => line != null);

  return {
    snapshot,
    prompt: lines.join("\n"),
  };
}

/**
 * Phase-scoped strategy context for pipeline workers.
 * Includes only structured session fields (presets, enums, numeric limits) — no free-text
 * notes or tradeRulesMarkdown, so prompts stay predictable without runtime truncation.
 */
export function buildWorkerStrategyPromptContext(
  context: SessionStrategyContext,
  request: WorkerStrategyContextRequest,
): string {
  const fields = new Set(request.fields);

  return WORKER_STRATEGY_FACT_SECTIONS.filter((section) =>
    fields.has(section.field),
  )
    .flatMap((section) => section.render(context))
    .filter((line): line is string => line != null)
    .join("\n");
}

export function prependStrategyContextToUserPrompt(
  context: SessionStrategyContext,
  userPrompt: string,
): StrategyPromptContext {
  const built = buildStrategyPromptContext(context);
  return {
    snapshot: built.snapshot,
    prompt: `${built.prompt}\n\n${userPrompt}`,
  };
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function renderNullable(label: string, value: number | null): string | null {
  return value == null ? null : `${label}: ${value}`;
}
