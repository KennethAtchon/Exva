// Time is injected everywhere so the same code runs live, accelerated (demo) and in backtests.

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

/** Manually advanced clock for backtests and tests. */
export class SimClock implements Clock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  async sleep(ms: number): Promise<void> {
    this.t += ms;
  }
}

/** Real-time clock running `speed` times faster than the wall clock (demo mode). */
export class FastClock implements Clock {
  private readonly realStart = Date.now();
  constructor(
    private readonly start: number,
    private readonly speed: number,
  ) {}
  now(): number {
    return this.start + (Date.now() - this.realStart) * this.speed;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms / this.speed)));
  }
}
