import type { Logger } from "../infra/log";
import type {
  ForwardReturnResolver,
  LabelBuilderService,
} from "./label-builder-service";

/**
 * Periodically backfills labels for observations whose horizon has passed (P2).
 * Mirrors {@link BrokerBalanceTicker}: a simple interval that runs the label
 * builder, resilient to individual failures.
 */
export class LabelBuilderTicker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly labelBuilder: LabelBuilderService,
    private readonly resolver: ForwardReturnResolver,
    private readonly logger: Logger,
    private readonly tickIntervalMs = 15 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.labelBuilder.runDue(this.resolver);
      if (result.labeled > 0) {
        this.logger.info(
          { labeled: result.labeled, skipped: result.skipped },
          "label builder backfilled forward returns",
        );
      }
    } catch (err) {
      this.logger.warn({ err }, "label builder tick failed");
    } finally {
      this.running = false;
    }
  }
}
