/**
 * Per-route provider health and circuit breaking (Solution 07 WS1).
 */

export type CircuitState = "closed" | "half_open" | "open";

export interface ProviderHealth {
  key: string;
  windowStart: string;
  attempts: number;
  failures: number;
  consecutiveFailures: number;
  state: CircuitState;
  openedAt: string | null;
  cooldownMs: number;
  lastError: { code: string; message: string } | null;
}

export interface ProviderHealthTrackerOptions {
  windowMs?: number;
  minAttemptsForRate?: number;
  failureRateOpen?: number;
  consecutiveTimeoutsOpen?: number;
  initialCooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => Date;
}

const DEFAULTS = {
  windowMs: 10 * 60_000,
  minAttemptsForRate: 6,
  failureRateOpen: 0.5,
  consecutiveTimeoutsOpen: 4,
  initialCooldownMs: 5 * 60_000,
  maxCooldownMs: 30 * 60_000,
};

export class ProviderHealthTracker {
  private readonly health = new Map<string, ProviderHealth>();
  private readonly opts: Required<ProviderHealthTrackerOptions>;

  constructor(options: ProviderHealthTrackerOptions = {}) {
    this.opts = {
      windowMs: options.windowMs ?? DEFAULTS.windowMs,
      minAttemptsForRate:
        options.minAttemptsForRate ?? DEFAULTS.minAttemptsForRate,
      failureRateOpen: options.failureRateOpen ?? DEFAULTS.failureRateOpen,
      consecutiveTimeoutsOpen:
        options.consecutiveTimeoutsOpen ?? DEFAULTS.consecutiveTimeoutsOpen,
      initialCooldownMs:
        options.initialCooldownMs ?? DEFAULTS.initialCooldownMs,
      maxCooldownMs: options.maxCooldownMs ?? DEFAULTS.maxCooldownMs,
      now: options.now ?? (() => new Date()),
    };
  }

  key(providerType: string, modelId: string): string {
    return `${providerType}::${modelId}`;
  }

  get(providerType: string, modelId: string): ProviderHealth {
    const k = this.key(providerType, modelId);
    return this.ensure(k);
  }

  /** Whether a call may proceed on this route (not hard-open). */
  isAvailable(providerType: string, modelId: string): boolean {
    const h = this.get(providerType, modelId);
    this.maybeTransition(h);
    return h.state !== "open";
  }

  recordSuccess(providerType: string, modelId: string): void {
    const h = this.get(providerType, modelId);
    this.maybeResetWindow(h);
    h.attempts += 1;
    h.consecutiveFailures = 0;
    h.lastError = null;
    if (h.state === "half_open") {
      h.state = "closed";
      h.openedAt = null;
      h.cooldownMs = this.opts.initialCooldownMs;
    }
  }

  recordFailure(
    providerType: string,
    modelId: string,
    error: { code: string; message: string },
    opts?: { timeoutExhaustion?: boolean },
  ): void {
    const h = this.get(providerType, modelId);
    this.maybeResetWindow(h);
    h.attempts += 1;
    h.failures += 1;
    h.consecutiveFailures += 1;
    h.lastError = error;

    if (h.state === "half_open") {
      h.state = "open";
      h.openedAt = this.opts.now().toISOString();
      h.cooldownMs = Math.min(h.cooldownMs * 2, this.opts.maxCooldownMs);
      return;
    }

    const rate = h.attempts > 0 ? h.failures / h.attempts : 0;
    const rateTrip =
      h.attempts >= this.opts.minAttemptsForRate &&
      rate > this.opts.failureRateOpen;
    const timeoutTrip =
      Boolean(opts?.timeoutExhaustion) &&
      h.consecutiveFailures >= this.opts.consecutiveTimeoutsOpen;

    if (rateTrip || timeoutTrip) {
      h.state = "open";
      h.openedAt = this.opts.now().toISOString();
    }
  }

  list(): ProviderHealth[] {
    return [...this.health.values()].map((h) => {
      this.maybeTransition(h);
      return { ...h };
    });
  }

  private ensure(key: string): ProviderHealth {
    let h = this.health.get(key);
    if (!h) {
      h = {
        key,
        windowStart: this.opts.now().toISOString(),
        attempts: 0,
        failures: 0,
        consecutiveFailures: 0,
        state: "closed",
        openedAt: null,
        cooldownMs: this.opts.initialCooldownMs,
        lastError: null,
      };
      this.health.set(key, h);
    }
    return h;
  }

  private maybeResetWindow(h: ProviderHealth): void {
    const elapsed =
      this.opts.now().getTime() - Date.parse(h.windowStart);
    if (elapsed >= this.opts.windowMs) {
      h.windowStart = this.opts.now().toISOString();
      h.attempts = 0;
      h.failures = 0;
    }
  }

  private maybeTransition(h: ProviderHealth): void {
    if (h.state !== "open" || !h.openedAt) return;
    const elapsed = this.opts.now().getTime() - Date.parse(h.openedAt);
    if (elapsed >= h.cooldownMs) {
      h.state = "half_open";
    }
  }
}
