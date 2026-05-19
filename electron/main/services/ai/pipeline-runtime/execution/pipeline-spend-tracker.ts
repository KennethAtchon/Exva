export type SpendCapKind = "phase" | "pipeline" | "session";

export interface SpendCapExceeded {
  kind: SpendCapKind;
  spentUsd: number;
  capUsd: number;
}

export interface PipelineSpendTrackerOptions {
  phaseSpendCapUsd: number | null;
  pipelineSpendCapUsd: number | null;
  sessionSpendCapUsd: number | null;
  sessionSpentBeforeRunUsd: number;
  pipelineSpentBeforePhaseUsd?: number;
}

/** Tracks cumulative AI spend for phase / pipeline-run / session caps. */
export class PipelineSpendTracker {
  private phaseSpentUsd = 0;

  constructor(private readonly options: PipelineSpendTrackerOptions) {}

  record(costUsd: number): void {
    if (costUsd > 0) this.phaseSpentUsd += costUsd;
  }

  check(): SpendCapExceeded | null {
    const pipelineSpent =
      (this.options.pipelineSpentBeforePhaseUsd ?? 0) + this.phaseSpentUsd;
    const sessionSpent = this.options.sessionSpentBeforeRunUsd + this.phaseSpentUsd;

    if (this.options.sessionSpendCapUsd != null && sessionSpent > this.options.sessionSpendCapUsd) {
      return { kind: "session", spentUsd: sessionSpent, capUsd: this.options.sessionSpendCapUsd };
    }
    if (this.options.pipelineSpendCapUsd != null && pipelineSpent > this.options.pipelineSpendCapUsd) {
      return { kind: "pipeline", spentUsd: pipelineSpent, capUsd: this.options.pipelineSpendCapUsd };
    }
    if (this.options.phaseSpendCapUsd != null && this.phaseSpentUsd > this.options.phaseSpendCapUsd) {
      return { kind: "phase", spentUsd: this.phaseSpentUsd, capUsd: this.options.phaseSpendCapUsd };
    }
    return null;
  }

  canContinue(): boolean {
    return this.check() === null;
  }

  get phaseSpent(): number {
    return this.phaseSpentUsd;
  }

  get pipelineSpent(): number {
    return (this.options.pipelineSpentBeforePhaseUsd ?? 0) + this.phaseSpentUsd;
  }

  abortLogMessage(): string | null {
    const exceeded = this.check();
    if (!exceeded) return null;
    return `[pipeline] aborting further workers: spend $${exceeded.spentUsd.toFixed(4)} exceeded cap $${exceeded.capUsd.toFixed(4)} (${exceeded.kind})`;
  }
}
