/**
 * Calibration store: maps model forecast probabilities to empirical win rates
 * and produces sizing haircuts for uncalibrated models.
 */

export interface CalibrationBucket {
  label: string;
  /** Forecast p mid for this bucket, e.g. 0.55 for "0.5-0.6". */
  pMid: number;
  sampleSize: number;
  empiricalWinRate: number;
  /** Wilson lower bound on win rate. */
  wilsonLower: number;
}

export interface ModelCalibration {
  modelId: string;
  modelVersion: string;
  buckets: CalibrationBucket[];
  brierScore: number;
  updatedAt: string;
}

export interface LabelObservation {
  predictedProbability: number;
  outcomeWin: boolean;
}

const BUCKET_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];

export class CalibrationService {
  private store = new Map<string, ModelCalibration>();

  key(modelId: string, modelVersion: string): string {
    return `${modelId}@${modelVersion}`;
  }

  get(modelId: string, modelVersion: string): ModelCalibration | null {
    return this.store.get(this.key(modelId, modelVersion)) ?? null;
  }

  /**
   * Recompute reliability buckets + Brier from labeled observations.
   */
  refresh(
    modelId: string,
    modelVersion: string,
    labels: LabelObservation[],
    asOf: string = new Date().toISOString(),
  ): ModelCalibration {
    const buckets: CalibrationBucket[] = [];
    for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
      const lo = BUCKET_EDGES[i];
      const hi = BUCKET_EDGES[i + 1];
      if (lo == null || hi == null) continue;
      const inBucket = labels.filter(
        (l) => l.predictedProbability >= lo && l.predictedProbability < hi,
      );
      const wins = inBucket.filter((l) => l.outcomeWin).length;
      const n = inBucket.length;
      const empiricalWinRate = n === 0 ? (lo + hi) / 2 : wins / n;
      buckets.push({
        label: `${lo.toFixed(1)}-${Math.min(1, hi).toFixed(1)}`,
        pMid: (lo + Math.min(1, hi)) / 2,
        sampleSize: n,
        empiricalWinRate,
        wilsonLower: wilsonLowerBound(wins, n),
      });
    }

    const brier =
      labels.length === 0
        ? 1
        : labels.reduce((s, l) => {
            const y = l.outcomeWin ? 1 : 0;
            return s + (l.predictedProbability - y) ** 2;
          }, 0) / labels.length;

    const cal: ModelCalibration = {
      modelId,
      modelVersion,
      buckets,
      brierScore: brier,
      updatedAt: asOf,
    };
    this.store.set(this.key(modelId, modelVersion), cal);
    return cal;
  }

  list(): ModelCalibration[] {
    return [...this.store.values()];
  }

  /**
   * Haircut in [0,1] applied to Kelly size. Uncalibrated → near 0.
   * Well-calibrated with samples → approaches 1.
   */
  calibrationHaircut(modelId: string, modelVersion: string, p: number): number {
    const cal = this.get(modelId, modelVersion);
    if (!cal) return 0.15; // max haircut for unknown models
    const bucket = cal.buckets.find((b) => {
      const [lo, hi] = b.label.split("-").map(Number);
      return p >= (lo ?? 0) && p < (hi ?? 1);
    });
    if (!bucket || bucket.sampleSize < 10) return 0.25;
    // Penalize high Brier and reward sample size.
    const brierFactor = Math.max(0.1, 1 - cal.brierScore * 2);
    const sampleFactor = Math.min(1, bucket.sampleSize / 50);
    return Math.max(0.1, Math.min(1, brierFactor * sampleFactor));
  }
}

/** Wilson score lower bound (95%). */
function wilsonLowerBound(wins: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

export const defaultCalibrationService = new CalibrationService();
