/**
 * Forecaster + Red Team combination (Part C.5 of the prediction-market
 * redesign). An LLM forecaster produces a probability estimate `pHat` from the
 * evidence it gathered; a separate adversarial pass (the red team) hunts for
 * disconfirming evidence and states its own `pHat`. Their *disagreement* is the
 * signal: rather than averaging it away, we widen the uncertainty band, which
 * the downstream Kelly sizing treats as a haircut. The model forms the view;
 * deterministic code here only combines the two views into a band.
 */

export interface ForecastView {
  /** Estimated probability of YES resolution, [0,1]. */
  pHat: number;
  /** 1-sigma uncertainty on pHat, in bps (e.g. 800 = 8%). */
  uncertaintyBps: number;
}

export interface CombinedForecast {
  pHat: number;
  uncertaintyBps: number;
  /** |forecaster.pHat - redTeam.pHat| in bps — the disagreement that fed the band. */
  disagreementBps: number;
}

export interface CombineOptions {
  /**
   * Weight on the red team's probability when blending [0,1]. Defaults to 0.5
   * (equal weight). The red team is adversarial, so weighting it >= 0.5 biases
   * toward caution.
   */
  redTeamWeight?: number;
}

/**
 * Blend the two probability views and widen the uncertainty band by their
 * disagreement.
 *
 *   pHat          = (1-w)*forecaster + w*redTeam
 *   disagreement  = |forecaster - redTeam|
 *   uncertainty   = max(forecaster, redTeam band) + disagreement
 *
 * The widened band only ever increases uncertainty, never shrinks it, so a
 * confident forecaster cannot be made to look more certain by agreement.
 */
export function combineForecasterAndRedTeam(
  forecaster: ForecastView,
  redTeam: ForecastView,
  options: CombineOptions = {},
): CombinedForecast {
  const w = clamp01(options.redTeamWeight ?? 0.5);
  const pF = clamp01(forecaster.pHat);
  const pR = clamp01(redTeam.pHat);

  const pHat = (1 - w) * pF + w * pR;
  const disagreementBps = Math.abs(pF - pR) * 10_000;
  const baseBand = Math.max(
    Math.max(0, forecaster.uncertaintyBps),
    Math.max(0, redTeam.uncertaintyBps),
  );

  return {
    pHat,
    uncertaintyBps: baseBand + disagreementBps,
    disagreementBps,
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
