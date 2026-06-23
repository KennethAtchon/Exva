/**
 * Statistically conservative primitives for deciding whether a strategy has
 * real edge (P1). These replace point-estimate-only promotion checks with
 * lower-bound and multiple-testing-aware measures.
 *
 * All functions are pure and deterministic given a seeded RNG, so backtests
 * and tests reproduce exactly.
 */

export interface ConfidenceInterval {
  point: number;
  lower: number;
  upper: number;
  /** Confidence level, e.g. 0.95. */
  level: number;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1 denominator). */
export function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance =
    xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Deterministic mulberry32 PRNG so bootstrap results are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap confidence interval of the mean. Resamples `iterations` times and
 * takes empirical percentiles. Use the `lower` bound — not the point estimate —
 * as the promotion gate so luck-driven strategies do not pass.
 */
export function bootstrapMeanCI(
  xs: readonly number[],
  options?: { iterations?: number; level?: number; seed?: number },
): ConfidenceInterval {
  const level = options?.level ?? 0.95;
  const iterations = options?.iterations ?? 2000;
  const point = mean(xs);
  if (xs.length < 2) {
    return { point, lower: point, upper: point, level };
  }

  const rng = mulberry32(options?.seed ?? 0x9e3779b9);
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) {
      const idx = Math.floor(rng() * xs.length);
      sum += xs[idx] ?? 0;
    }
    means[i] = sum / xs.length;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    point,
    lower: percentile(means, alpha),
    upper: percentile(means, 1 - alpha),
    level,
  };
}

/** Linear-interpolated percentile of a pre-sorted ascending array. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return (sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac;
}

/**
 * Sharpe ratio of a return series. Optionally annualized by sqrt of
 * `periodsPerYear`. Returns 0 when there is insufficient data or zero variance.
 */
export function sharpeRatio(
  returns: readonly number[],
  options?: { riskFreePerPeriod?: number; periodsPerYear?: number },
): number {
  if (returns.length < 2) return 0;
  const rf = options?.riskFreePerPeriod ?? 0;
  const excess = returns.map((r) => r - rf);
  const sd = stddev(excess);
  if (sd === 0) return 0;
  const sharpe = mean(excess) / sd;
  const periods = options?.periodsPerYear;
  return periods ? sharpe * Math.sqrt(periods) : sharpe;
}

/**
 * Standard error of the Sharpe ratio estimate (Lo, 2002 approximation) and the
 * resulting lower confidence bound. We want the lower bound positive, not just
 * the point estimate.
 */
export function sharpeLowerBound(
  returns: readonly number[],
  level = 0.95,
): { sharpe: number; stdError: number; lower: number } {
  const n = returns.length;
  const sharpe = sharpeRatio(returns);
  if (n < 2) return { sharpe: 0, stdError: 0, lower: 0 };
  // SE(SR) ~= sqrt((1 + 0.5 * SR^2) / n) for iid returns.
  const stdError = Math.sqrt((1 + 0.5 * sharpe ** 2) / n);
  const z = zForLevel(level);
  return { sharpe, stdError, lower: sharpe - z * stdError };
}

/**
 * Deflated Sharpe penalty for multiple testing: shrinks an observed Sharpe by
 * the expected maximum Sharpe under the null when `numTrials` variants were
 * tested. Penalizes trying many parameter sets until one looks good.
 *
 * Returns the deflated Sharpe (observed minus expected-max-under-null).
 */
export function deflatedSharpe(
  observedSharpe: number,
  numTrials: number,
): number {
  if (numTrials <= 1) return observedSharpe;
  // Expected maximum of N iid standard normals ~= sqrt(2 ln N).
  const expectedMax = Math.sqrt(2 * Math.log(numTrials));
  return observedSharpe - expectedMax;
}

/** Two-sided z critical value for common confidence levels. */
function zForLevel(level: number): number {
  if (level >= 0.99) return 2.576;
  if (level >= 0.95) return 1.96;
  if (level >= 0.9) return 1.645;
  return 1.0;
}

/**
 * Brier score: mean squared error between predicted probabilities and binary
 * outcomes (1 = occurred, 0 = not). Lower is better; a strictly proper scoring
 * rule for probability forecasts.
 */
export function brierScore(
  predictions: readonly { probability: number; outcome: 0 | 1 }[],
): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce(
    (acc, p) => acc + (p.probability - p.outcome) ** 2,
    0,
  );
  return sum / predictions.length;
}

export interface ReliabilityBucket {
  /** Bucket lower edge, e.g. 0.5 for the [0.5, 0.6) bucket. */
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number;
  observedFrequency: number;
}

/**
 * Reliability buckets: group predictions into probability bins and compare the
 * mean predicted probability to the realized frequency. Directional calibration
 * means observedFrequency tracks meanPredicted across buckets.
 */
export function reliabilityBuckets(
  predictions: readonly { probability: number; outcome: 0 | 1 }[],
  bucketCount = 10,
): ReliabilityBucket[] {
  const buckets: ReliabilityBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lower = i / bucketCount;
    const upper = (i + 1) / bucketCount;
    const inBucket = predictions.filter(
      (p) =>
        p.probability >= lower &&
        (i === bucketCount - 1 ? p.probability <= upper : p.probability < upper),
    );
    buckets.push({
      lower,
      upper,
      count: inBucket.length,
      meanPredicted: inBucket.length ? mean(inBucket.map((p) => p.probability)) : 0,
      observedFrequency: inBucket.length
        ? mean(inBucket.map((p) => p.outcome))
        : 0,
    });
  }
  return buckets;
}

export interface PurgedFold {
  index: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

/**
 * Rolling walk-forward folds with a purge gap between train and test to avoid
 * leakage from adjacent time windows. `n` items are split into `folds`
 * contiguous expanding-train / forward-test segments; `purge` items between
 * train and test are dropped.
 */
export function purgedWalkForwardFolds(
  n: number,
  folds: number,
  purge = 0,
): PurgedFold[] {
  if (n <= 0 || folds < 1) return [];
  const result: PurgedFold[] = [];
  const segment = Math.floor(n / (folds + 1));
  if (segment < 1) return [];
  for (let i = 0; i < folds; i++) {
    const trainEnd = segment * (i + 1);
    const testStart = Math.min(n, trainEnd + purge);
    const testEnd = i === folds - 1 ? n : Math.min(n, testStart + segment);
    if (testStart >= testEnd) continue;
    result.push({
      index: i,
      trainStart: 0,
      trainEnd,
      testStart,
      testEnd,
    });
  }
  return result;
}
