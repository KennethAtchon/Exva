import {
  isLiveSignalSourceType,
  isSignalExpired,
  type SignalSourceRecord,
} from "@electron/shared/domain";
import type { SignalDeadLetterReason } from "@electron/shared/domain/signal-dead-letters";
import { AppError } from "@electron/shared/infra/errors";
import { SignalDeadLettersRepo } from "./repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "./repos/signal-deliveries-repo";
import { SignalEventsRepo } from "./repos/signal-events-repo";
import { SignalSourcesRepo } from "./repos/signal-sources-repo";
import { SignalSourceRegistry } from "./signal-source-registry";
import { SignalBus } from "./signal-bus";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  payloadSchemaForKind,
  type MarketSignalKind,
} from "@electron/shared/domain/market-signal";
import type { InstrumentClass } from "@electron/shared/domain/enums";

const MANUAL_SOURCE_ID = "manual_source";
type SessionReadiness =
  | "armed"
  | "manual_only"
  | "waiting_for_source_enable"
  | "no_inputs";

function instrumentClassForKind(kind: MarketSignalKind): InstrumentClass {
  if (kind === "market_dislocation") return "prediction_market";
  if (kind === "flow_anomaly") return "options";
  return "stock";
}

export class SignalService {
  constructor(
    private readonly sourcesRepo: SignalSourcesRepo,
    private readonly eventsRepo: SignalEventsRepo,
    private readonly deliveriesRepo: SignalDeliveriesRepo,
    private readonly deadLettersRepo: SignalDeadLettersRepo,
    private readonly registry: SignalSourceRegistry,
    private readonly signalBus: SignalBus,
    private readonly sessionRepo?: {
      list(input?: {
        includeArchived?: boolean;
      }): Array<{ id: string; name: string }>;
    },
  ) {}

  listSources(): Array<
    SignalSourceRecord & {
      runtimeStatus: string;
      runtimeLastError: string | null;
      attachedSessionCount: number;
    }
  > {
    const runtimeRepo = this.registry.getRuntimeRepo();
    return this.sourcesRepo.list().map((source) => {
      const runtime = this.registry.status(source.id);
      const snapshot = this.registry.snapshot(source.id);
      const durable = runtimeRepo.get(source.id);
      return {
        ...source,
        runtimeStatus: runtime?.status ?? durable?.status ?? "idle",
        runtimeLastError: runtime?.lastError ?? durable?.lastError ?? null,
        attachedSessionCount: 0,
        attachedSessionNames: [] as string[],
        lastPollAt: snapshot?.lastPollAt ?? durable?.lastPollAt ?? null,
        lastPollResult:
          snapshot?.lastPollResult ??
          (durable
            ? {
                detected: durable.detected,
                passed: durable.passed,
                dropped: durable.dropped,
                errors: durable.errors,
              }
            : null),
        lastSignalAt: snapshot?.lastSignalAt ?? null,
        lastSignalTicker: snapshot?.lastSignalTicker ?? null,
        recentActivity: snapshot?.recentActivity ?? [],
        durableRuntime: durable,
      };
    });
  }

  async createSource(input: {
    type: SignalSourceRecord["type"];
    name: string;
    description?: string | null;
    config?: Record<string, unknown>;
  }): Promise<SignalSourceRecord> {
    if (!isLiveSignalSourceType(input.type)) {
      throw new AppError(
        `Unknown signal source type: ${String(input.type)}; use edgar_8k, mock, manual, or prediction_event.`,
        "VALIDATION_FAILED",
      );
    }
    const source = this.sourcesRepo.create({
      id: crypto.randomUUID(),
      type: input.type,
      name: input.name,
      description: input.description ?? null,
      enabled: true,
      configJson: JSON.stringify(input.config ?? {}),
    });
    this.registry.create(source);
    await this.registry.start(source.id);
    return source;
  }

  getSource(sourceId: string): SignalSourceRecord | null {
    return this.sourcesRepo.get(sourceId);
  }

  async updateSource(
    sourceId: string,
    patch: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      config: Record<string, unknown>;
    }>,
  ): Promise<SignalSourceRecord> {
    const next = this.sourcesRepo.update(sourceId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.config !== undefined
        ? { configJson: JSON.stringify(patch.config) }
        : {}),
    });
    if (patch.config !== undefined) {
      await this.registry.restart(sourceId, patch.config);
    }
    if (patch.enabled === true) await this.registry.start(sourceId);
    if (patch.enabled === false) await this.registry.stop(sourceId);
    return next;
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.registry.remove(sourceId);
    this.sourcesRepo.delete(sourceId);
  }

  async testSource(sourceId: string) {
    const result = await this.registry.test(sourceId);
    if (!result) {
      throw new AppError(`Signal source ${sourceId} not found.`, "NOT_FOUND", {
        sourceId,
      });
    }
    return result;
  }

  async enableSource(sourceId: string): Promise<void> {
    this.sourcesRepo.setEnabled(sourceId, true);
    await this.registry.start(sourceId);
  }

  async disableSource(sourceId: string): Promise<void> {
    this.sourcesRepo.setEnabled(sourceId, false);
    await this.registry.stop(sourceId);
  }

  listEventsBySession(input: {
    sessionId: string;
    statusBucket?: "pending" | "completed" | "dropped";
    limit?: number;
  }) {
    return this.deliveriesRepo.listBySessionFiltered(input);
  }

  listDeadLettersBySession(input: {
    sessionId: string;
    reason?: SignalDeadLetterReason;
    limit?: number;
  }) {
    return this.deadLettersRepo.listBySessionFiltered(input);
  }

  async replayDeadLetter(
    deadLetterId: string,
  ): Promise<{ deliveryId: string }> {
    const deadLetter = this.deadLettersRepo.getById(deadLetterId);
    if (!deadLetter) {
      throw new AppError(
        `Dead letter ${deadLetterId} was not found.`,
        "NOT_FOUND",
        { deadLetterId },
      );
    }
    if (deadLetter.replayedAt) {
      throw new AppError(
        "This dead letter has already been replayed.",
        "VALIDATION_FAILED",
        { deadLetterId },
      );
    }

    const event = this.eventsRepo.getById(deadLetter.signalEventId);
    if (!event) {
      throw new AppError(
        `Signal event ${deadLetter.signalEventId} was not found.`,
        "NOT_FOUND",
        { signalEventId: deadLetter.signalEventId },
      );
    }

    const result = await this.signalBus.deliverOrDeadLetter(
      deadLetter.sessionId,
      event,
    );
    if (result.kind === "dead_letter") {
      throw new AppError(
        "Replay still rejected by the capability gate.",
        "VALIDATION_FAILED",
        { deadLetterId, newDeadLetterId: result.deadLetterId },
      );
    }

    this.deadLettersRepo.markReplayed(deadLetterId, result.deliveryId);
    return { deliveryId: result.deliveryId };
  }

  bootstrapFromDb(): void {
    if (!this.sourcesRepo.get(MANUAL_SOURCE_ID)) {
      this.sourcesRepo.create({
        id: MANUAL_SOURCE_ID,
        type: "manual",
        name: "Manual Source",
        description: "Implicit source for manual session tickers",
        enabled: true,
        configJson: "{}",
      });
    }
    for (const source of this.sourcesRepo.list()) {
      if (source.type === "manual") continue;
      this.registry.create(source);
      if (source.enabled) {
        void this.registry.start(source.id);
      }
    }
  }

  /** Dev Panel typed injection validated against the signal-kind schema. */
  debugInjectSignal(
    sessionId: string,
    opts: {
      kind: MarketSignalKind;
      payload: Record<string, unknown>;
      symbol?: string;
    },
  ): void {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const { kind } = opts;
    const symbol = opts.symbol ?? (kind === "manual" ? "SPY" : "TEST");
    const parsedPayload = payloadSchemaForKind(kind).parse(opts.payload);
    const dedupeKey = computeDedupeKey(kind, {
      debug: id,
      symbol,
    });
    this.signalBus.injectManual(
      {
        id,
        sourceId: MANUAL_SOURCE_ID,
        sourceType: "manual",
        ticker: symbol,
        companyName: null,
        documentUrl: null,
        accessionNumber: null,
        payloadJson: {
          instrumentClass: instrumentClassForKind(kind),
          ...parsedPayload,
        },
        filedAt: now,
        detectedAt: now,
        kind,
        dedupeKey,
        ttl: DEFAULT_SIGNAL_TTL[kind],
        occurredAt: now,
      },
      sessionId,
    );
  }

  debugForceTrade(sessionId: string) {
    return this.signalBus.debugForceTrade(sessionId);
  }

  onSessionResumed(sessionId: string): void {
    const rows = this.deliveriesRepo.listBySessionAndStatus(
      sessionId,
      "waiting_for_resume",
    );
    const now = Date.now();
    for (const delivery of rows) {
      const expired =
        delivery.expiresAt != null && Date.parse(delivery.expiresAt) < now;
      if (expired) {
        this.deliveriesRepo.updateStatus(delivery.id, {
          status: "expired",
          statusBucket: "dropped",
          finishedAt: new Date().toISOString(),
        });
        this.signalBus.emitDeliveryUpdated({
          deliveryId: delivery.id,
          sessionId: delivery.sessionId,
          signalId: delivery.signalEventId,
          status: "expired",
          statusBucket: "dropped",
        });
      } else {
        this.deliveriesRepo.updateStatus(delivery.id, {
          status: "queued",
          statusBucket: "pending",
          expiresAt: null,
        });
        this.signalBus.emitDeliveryUpdated({
          deliveryId: delivery.id,
          sessionId: delivery.sessionId,
          signalId: delivery.signalEventId,
          status: "queued",
          statusBucket: "pending",
        });
      }
    }
  }

  replayStartup(): void {
    for (const delivery of this.deliveriesRepo.listByStatus("processing")) {
      this.deliveriesRepo.updateStatus(delivery.id, {
        status: "queued",
        statusBucket: "pending",
        startedAt: null,
      });
      this.signalBus.emitDeliveryUpdated({
        deliveryId: delivery.id,
        sessionId: delivery.sessionId,
        signalId: delivery.signalEventId,
        status: "queued",
        statusBucket: "pending",
      });
    }

    for (const delivery of this.deliveriesRepo.listByStatus(
      "waiting_for_resume",
    )) {
      const expired =
        delivery.expiresAt != null &&
        Date.parse(delivery.expiresAt) < Date.now();
      if (!expired) continue;
      this.deliveriesRepo.updateStatus(delivery.id, {
        status: "expired",
        statusBucket: "dropped",
        finishedAt: new Date().toISOString(),
      });
      this.signalBus.emitDeliveryUpdated({
        deliveryId: delivery.id,
        sessionId: delivery.sessionId,
        signalId: delivery.signalEventId,
        status: "expired",
        statusBucket: "dropped",
      });
    }

    // V2: undispatched events with no session_signal_sources are dropped on startup.
    for (const row of this.eventsRepo.listByDispatchStatus("new")) {
      const event = this.eventsRepo.getById(row.id);
      if (!event) continue;
      this.eventsRepo.markDispatchStatus(
        event.id,
        "dropped_pre_fanout",
        isSignalExpired(event.detectedAt, event.ttl)
          ? "ttl_expired_at_startup"
          : "no_subscribers_at_startup",
      );
    }
  }

  deriveReadiness(
    _sessionId: string,
    instrumentScope: string,
  ): SessionReadiness {
    const manualTickers = instrumentScope
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean).length;
    return manualTickers > 0 ? "manual_only" : "no_inputs";
  }
}
