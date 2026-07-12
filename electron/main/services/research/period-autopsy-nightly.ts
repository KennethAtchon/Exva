import type {
  PeriodAutopsyPreview,
  PeriodAutopsyRecord,
  PeriodAutopsyRunInput,
} from "@electron/shared/domain/autopsy";
import { createLogger } from "../infra/log";

const logger = createLogger("period-autopsy-nightly");

/** Skip unattended LLM when estimated cost exceeds this (USD). */
const HIGH_COST_SKIP_USD = 5;
/** Opt-in run only allowed at or below this estimate (USD). */
const CHEAP_RUN_MAX_USD = 1;

const EMPTY_FILTERS: PeriodAutopsyRunInput["filters"] = {
  instrumentClasses: [],
  brokerAccountIds: [],
  outcome: "all",
  minPositionSizeUsd: 0,
  includeAgentPhases: [],
};

export interface PeriodAutopsyNightlyDeps {
  preview: (input: PeriodAutopsyRunInput) => PeriodAutopsyPreview;
  run?: (input: PeriodAutopsyRunInput) => Promise<PeriodAutopsyRecord>;
  /**
   * When true, do not early-return on estimatedCostUsd > HIGH_COST_SKIP_USD.
   * Expensive unattended `run` still requires allowHighCostRun + opt-in below.
   */
  allowHighCostPreviewContinue?: boolean;
  /**
   * Opt-in to call PeriodAutopsyService.run (LLM). Default false = preview only.
   * Maps to EXVA_PERIOD_AUTOPSY_RUN=true.
   */
  optInRun?: boolean;
  /**
   * Soft flag: allow opt-in run when estimate exceeds HIGH_COST_SKIP_USD
   * (passes confirmHighCost). Maps to EXVA_PERIOD_AUTOPSY_ALLOW_HIGH_COST=true.
   */
  allowHighCostRun?: boolean;
  now?: () => Date;
}

export interface PeriodAutopsyNightlyResult {
  /** One-line summary for the nightly digest. */
  summary: string;
  preview: PeriodAutopsyPreview;
  ran: boolean;
  record?: PeriodAutopsyRecord;
}

/**
 * Prior UTC calendar day window [start, end).
 */
export function priorUtcCalendarDayWindow(now: Date = new Date()): {
  windowStart: string;
  windowEnd: string;
} {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

/**
 * Safe unattended period-autopsy entrypoint: preview by default; optional cheap
 * LLM run only behind explicit opt-in.
 */
export async function runPeriodAutopsyNightly(
  deps: PeriodAutopsyNightlyDeps,
): Promise<PeriodAutopsyNightlyResult> {
  const now = deps.now?.() ?? new Date();
  const { windowStart, windowEnd } = priorUtcCalendarDayWindow(now);
  const input: PeriodAutopsyRunInput = {
    scope: "global",
    windowStart,
    windowEnd,
    filters: EMPTY_FILTERS,
  };

  const preview = deps.preview(input);
  logger.info(
    {
      windowStart,
      windowEnd,
      tradeCount: preview.tradeCount,
      estimatedCostUsd: preview.estimatedCostUsd,
    },
    "period autopsy nightly: preview",
  );

  if (preview.tradeCount === 0) {
    const summary = `period-autopsy: preview 0 trades (${windowStart.slice(0, 10)})`;
    logger.info(summary);
    return { summary, preview, ran: false };
  }

  const cost = preview.estimatedCostUsd;
  const highCost = cost > HIGH_COST_SKIP_USD;

  if (
    highCost &&
    !deps.allowHighCostPreviewContinue &&
    !deps.allowHighCostRun
  ) {
    const summary = `period-autopsy: skip high cost ~$${cost.toFixed(2)} (${preview.tradeCount} trades)`;
    logger.info(
      { estimatedCostUsd: cost, tradeCount: preview.tradeCount },
      "period autopsy nightly: skipping — estimated cost above $5 without soft flag",
    );
    return { summary, preview, ran: false };
  }

  const wantRun = deps.optInRun === true && deps.run != null;
  const cheapEnough = cost <= CHEAP_RUN_MAX_USD;
  const highCostAllowed = highCost && deps.allowHighCostRun === true;
  const canRun =
    wantRun && preview.tradeCount > 0 && (cheapEnough || highCostAllowed);

  if (!canRun) {
    const reason = !wantRun
      ? "preview-only (set EXVA_PERIOD_AUTOPSY_RUN=true to opt in)"
      : !cheapEnough && !highCostAllowed
        ? `cost ~$${cost.toFixed(2)} above $${CHEAP_RUN_MAX_USD} run cap`
        : "run unavailable";
    const summary = `period-autopsy: preview ${preview.tradeCount} trades ~$${cost.toFixed(2)} — ${reason}`;
    logger.info({ reason }, "period autopsy nightly: preview only");
    return { summary, preview, ran: false };
  }

  const run = deps.run;
  if (!run) {
    return {
      summary: `period-autopsy: preview ${preview.tradeCount} trades ~$${cost.toFixed(2)} — run unavailable`,
      preview,
      ran: false,
    };
  }

  const record = await run({
    ...input,
    confirmHighCost: highCostAllowed,
  });
  const summary = `period-autopsy: ran ${record.tradeCount} trades id=${record.id} cost=$${record.totalCostUsd.toFixed(2)}`;
  logger.info(
    { periodAutopsyId: record.id, totalCostUsd: record.totalCostUsd },
    "period autopsy nightly: run completed",
  );
  return { summary, preview, ran: true, record };
}

/** Map typed env flags onto nightly deps. */
export function periodAutopsyNightlyFlagsFromEnv(flags: {
  periodAutopsyRun: boolean;
  periodAutopsyAllowHighCost: boolean;
}): Pick<
  PeriodAutopsyNightlyDeps,
  "optInRun" | "allowHighCostRun" | "allowHighCostPreviewContinue"
> {
  return {
    optInRun: flags.periodAutopsyRun,
    allowHighCostRun: flags.periodAutopsyAllowHighCost,
    allowHighCostPreviewContinue: flags.periodAutopsyAllowHighCost,
  };
}
