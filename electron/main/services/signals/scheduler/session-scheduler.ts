/**
 * SessionScheduler — cadence/cron for experiences. NOT a signal source.
 * Quiet ticks produce no MarketSignal; setups emit scan_hit signals.
 */

export type MarketHoursMode = "regular" | "extended" | "24_7";

export interface ScheduleSpec {
  /** Cadence label: "15m", "1h", "4h", "1d". */
  cadence: string;
  marketHours: MarketHoursMode;
  /** Jitter as fraction of interval (0–1) to avoid thundering herd. */
  jitterPct?: number;
}

export interface ScanContext {
  sessionId: string;
  experienceId: string;
  now: Date;
  /** Symbol this scan targets (from experience signal descriptor). */
  symbol: string;
  instrumentClass: string;
  analysisTimeframe: string;
}

export interface ScheduledScan {
  id: string;
  experienceId: string;
  schedule: ScheduleSpec;
  symbol: string;
  instrumentClass: string;
  analysisTimeframe: string;
  run(
    ctx: ScanContext,
  ): Promise<import("@electron/shared/domain/market-signal").MarketSignal[]>;
}

export interface ScheduleTelemetry {
  scanId: string;
  firedAt: string;
  nextFireAt: string;
  hitCount: number;
  quiet: boolean;
  skippedMarketClosed: boolean;
}

function cadenceToMs(cadence: string): number {
  const match = cadence.match(/^(\d+)(m|h|d)$/i);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

/** US equity regular session rough check (America/New_York wall clock). */
export function isMarketOpen(
  mode: MarketHoursMode,
  now: Date = new Date(),
): boolean {
  if (mode === "24_7") return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  if (mode === "regular") {
    // 09:30–16:00 ET
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  }
  // extended: 04:00–20:00 ET
  return mins >= 4 * 60 && mins < 20 * 60;
}

export type SignalEmitFn = (
  signals: import("@electron/shared/domain/market-signal").MarketSignal[],
) => void | Promise<void>;

export class SessionScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private scans = new Map<string, ScheduledScan>();
  private telemetry = new Map<string, ScheduleTelemetry>();
  private running = false;

  constructor(private readonly onSignals: SignalEmitFn) {}

  register(scan: ScheduledScan): void {
    this.scans.set(scan.id, scan);
    if (this.running) this.arm(scan);
  }

  unregister(scanId: string): void {
    const timer = this.timers.get(scanId);
    if (timer) clearTimeout(timer);
    this.timers.delete(scanId);
    this.scans.delete(scanId);
    this.telemetry.delete(scanId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const scan of this.scans.values()) this.arm(scan);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  snapshot(): ScheduleTelemetry[] {
    return [...this.telemetry.values()];
  }

  getTelemetry(scanId: string): ScheduleTelemetry | null {
    return this.telemetry.get(scanId) ?? null;
  }

  /** Fire immediately (tests / debug). */
  async fireNow(scanId: string): Promise<ScheduleTelemetry | null> {
    const scan = this.scans.get(scanId);
    if (!scan) return null;
    return this.execute(scan);
  }

  private arm(scan: ScheduledScan): void {
    const existing = this.timers.get(scan.id);
    if (existing) clearTimeout(existing);
    const base = cadenceToMs(scan.schedule.cadence);
    const jitterPct = scan.schedule.jitterPct ?? 0.05;
    const jitter = base * jitterPct * (Math.random() * 2 - 1);
    const delay = Math.max(1000, Math.round(base + jitter));
    const nextFireAt = new Date(Date.now() + delay).toISOString();
    const prev = this.telemetry.get(scan.id);
    this.telemetry.set(scan.id, {
      scanId: scan.id,
      firedAt: prev?.firedAt ?? new Date(0).toISOString(),
      nextFireAt,
      hitCount: prev?.hitCount ?? 0,
      quiet: prev?.quiet ?? true,
      skippedMarketClosed: prev?.skippedMarketClosed ?? false,
    });
    this.timers.set(
      scan.id,
      setTimeout(() => {
        void this.execute(scan).then(() => {
          if (this.running && this.scans.has(scan.id)) this.arm(scan);
        });
      }, delay),
    );
  }

  private async execute(scan: ScheduledScan): Promise<ScheduleTelemetry> {
    const now = new Date();
    const open = isMarketOpen(scan.schedule.marketHours, now);
    if (!open) {
      const tel: ScheduleTelemetry = {
        scanId: scan.id,
        firedAt: now.toISOString(),
        nextFireAt:
          this.telemetry.get(scan.id)?.nextFireAt ?? now.toISOString(),
        hitCount: 0,
        quiet: true,
        skippedMarketClosed: true,
      };
      this.telemetry.set(scan.id, tel);
      return tel;
    }

    const signals = await scan.run({
      sessionId: "",
      experienceId: scan.experienceId,
      now,
      symbol: scan.symbol,
      instrumentClass: scan.instrumentClass,
      analysisTimeframe: scan.analysisTimeframe,
    });

    if (signals.length > 0) {
      await this.onSignals(signals);
    }

    const tel: ScheduleTelemetry = {
      scanId: scan.id,
      firedAt: now.toISOString(),
      nextFireAt: this.telemetry.get(scan.id)?.nextFireAt ?? now.toISOString(),
      hitCount: signals.length,
      quiet: signals.length === 0,
      skippedMarketClosed: false,
    };
    this.telemetry.set(scan.id, tel);
    return tel;
  }
}
