import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const intervalCadenceSchema = z.object({
  kind: z.literal("interval"),
  every: z.number().int().positive(),
  unit: z.enum(["minute", "hour", "day"]),
  jitterPct: z.number().min(0).max(0.25).default(0.05),
});

export const cronCadenceSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string().min(1),
  timezone: z.string().min(1),
});

export const cadenceSchema = z.discriminatedUnion("kind", [
  intervalCadenceSchema,
  cronCadenceSchema,
]);

export type IntervalCadence = z.infer<typeof intervalCadenceSchema>;
export type CronCadence = z.infer<typeof cronCadenceSchema>;
export type CadenceSpec = z.infer<typeof cadenceSchema>;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse an unknown value into a CadenceSpec. Throws a ZodError on invalid
 * input — no silent fallback is permitted.
 */
export function parseCadence(raw: unknown): CadenceSpec {
  return cadenceSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/** Milliseconds per unit — used for normalization. */
const UNIT_MS: Record<IntervalCadence["unit"], number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * Normalize an interval cadence to the coarsest unit that divides evenly.
 * e.g. `{ every: 60, unit: "minute" }` → `{ every: 1, unit: "hour" }`
 */
function normalizeIntervalUnits(
  every: number,
  unit: IntervalCadence["unit"],
): Pick<IntervalCadence, "every" | "unit"> {
  const totalMs = every * UNIT_MS[unit];
  if (totalMs % UNIT_MS["day"] === 0) {
    return { every: totalMs / UNIT_MS["day"], unit: "day" };
  }
  if (totalMs % UNIT_MS["hour"] === 0) {
    return { every: totalMs / UNIT_MS["hour"], unit: "hour" };
  }
  return { every: totalMs / UNIT_MS["minute"], unit: "minute" };
}

/**
 * Produce a stable, canonical JSON string for a CadenceSpec. The object keys
 * are sorted and interval units are normalized before serialization so that
 * semantically identical cadences produce the same string.
 */
export function serializeCadenceCanonical(cadence: CadenceSpec): string {
  if (cadence.kind === "interval") {
    const { every, unit } = normalizeIntervalUnits(cadence.every, cadence.unit);
    const obj: Record<string, unknown> = {
      every,
      jitterPct: cadence.jitterPct,
      kind: cadence.kind,
      unit,
    };
    // Sort keys for a deterministic output
    const sorted = Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
    return JSON.stringify(sorted);
  }
  // cron
  const obj: Record<string, unknown> = {
    expression: cadence.expression,
    kind: cadence.kind,
    timezone: cadence.timezone,
  };
  const sorted = Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  );
  return JSON.stringify(sorted);
}

// ---------------------------------------------------------------------------
// cadenceToMs
// ---------------------------------------------------------------------------

/**
 * Convert a CadenceSpec to its base interval in milliseconds.
 * - For interval cadences the jitter is NOT included; callers may add it.
 * - For cron cadences this throws because cron intervals are not constant.
 * - Any invalid input throws — there is NO silent fallback.
 */
export function cadenceToMs(cadence: CadenceSpec): number {
  if (cadence.kind === "cron") {
    throw new Error(
      "cadenceToMs: cron cadences do not have a fixed interval in ms. " +
        "Use a cron library to compute the next fire time.",
    );
  }
  const totalMs = cadence.every * UNIT_MS[cadence.unit];
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error(
      `cadenceToMs: computed ms is not positive (every=${cadence.every}, unit=${cadence.unit})`,
    );
  }
  return totalMs;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const UNIT_ABBREVIATION: Record<IntervalCadence["unit"], string> = {
  minute: "m",
  hour: "h",
  day: "d",
};

/** Human-readable label for a CadenceSpec, e.g. "every 15m" or "cron: 0 */
export function cadenceLabel(cadence: CadenceSpec): string {
  if (cadence.kind === "cron") {
    return `cron: ${cadence.expression} (${cadence.timezone})`;
  }
  const { every, unit } = normalizeIntervalUnits(cadence.every, cadence.unit);
  return `every ${every}${UNIT_ABBREVIATION[unit]}`;
}

/** Short abbreviation used for display, e.g. "15m", "1h", "1d". */
export function cadenceShortLabel(cadence: CadenceSpec): string {
  if (cadence.kind === "cron") {
    return cadence.expression;
  }
  const { every, unit } = normalizeIntervalUnits(cadence.every, cadence.unit);
  return `${every}${UNIT_ABBREVIATION[unit]}`;
}

// ---------------------------------------------------------------------------
// Legacy string parser
// ---------------------------------------------------------------------------

const LEGACY_LABEL_RE = /^(\d+)(m|h|d)$/;

/**
 * Parse legacy cadence label strings such as "15m", "1h", "4h", "1d" into a
 * CadenceSpec. Throws on unrecognised or zero/negative values.
 */
export function parseLegacyCadenceLabel(label: string): CadenceSpec {
  const match = label.trim().match(LEGACY_LABEL_RE);
  if (!match) {
    throw new Error(
      `parseLegacyCadenceLabel: unrecognised cadence label "${label}". ` +
        `Expected format: <positive-integer>(m|h|d), e.g. "15m", "1h", "4h", "1d".`,
    );
  }
  const every = parseInt(match[1], 10);
  if (every <= 0) {
    throw new Error(
      `parseLegacyCadenceLabel: cadence value must be positive, got ${every}.`,
    );
  }
  const rawUnit = match[2];
  const unitMap: Record<string, IntervalCadence["unit"]> = {
    m: "minute",
    h: "hour",
    d: "day",
  };
  const unit = unitMap[rawUnit];
  return intervalCadenceSchema.parse({ kind: "interval", every, unit });
}
