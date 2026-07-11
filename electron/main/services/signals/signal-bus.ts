import type { InstrumentClass } from "@/lib/types";
import type { EventBus } from "../infra/event-bus";
import type {
  MarketSignal,
  SignalEvent,
  SignalSourceType,
} from "@electron/shared/domain";
import {
  enrichSignalEvent,
  marketSignalToLegacyEvent,
  signalExpiresAt,
} from "@electron/shared/domain";
import { extractSignalInstrumentClass } from "@electron/shared/domain/signal-source-capabilities";
import { AppError } from "@electron/shared/infra/errors";
import type { InstrumentNormalizer } from "../broker/instrument-normalizer";
import type { ISignalSource } from "./ISignalSource";
import { SignalDeadLettersRepo } from "./repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "./repos/signal-deliveries-repo";
import { SignalEventsRepo } from "./repos/signal-events-repo";
import { SignalSourcesRepo } from "./repos/signal-sources-repo";
import { evaluateSignalDeliveryGate } from "./signal-delivery-gate";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import { runWithProviderCallScopeAsync } from "../infra/provider-call-log";

export interface DebugForceTradeResult {
  brokerType: string;
  brokerAccountId: string;
  instrumentClass: InstrumentClass;
  symbol: string;
  side: "BUY";
  sizeUsd: number;
  brokerOrderId: string;
  filledAvgPrice: number;
}

/** Notional size for the debug order. Kept above typical broker minimums. */
const DEBUG_FORCE_TRADE_SIZE_USD = 100;

/**
 * Default, liquid symbols per instrument class for the debug order, in
 * preference order. Crypto (BTC-USD) is first because it trades 24/7 — a debug
 * trade fired outside US market hours must still fill, whereas a stock market
 * order placed off-hours only queues and never reports a fill price. Classes
 * whose tradeable symbol is contract- or market-specific (futures front month,
 * a specific option, a specific prediction market) have no safe default and are
 * intentionally omitted — the picker fails loud rather than guessing.
 */
const DEBUG_DEFAULT_SYMBOLS: ReadonlyArray<{
  instrumentClass: InstrumentClass;
  symbol: string;
}> = [
  { instrumentClass: "crypto", symbol: "BTC-USD" },
  { instrumentClass: "stock", symbol: "SPY" },
];

/**
 * Choose an instrument class supported by one of the session's assigned brokers
 * for which we have a safe default symbol. Throws a clear error otherwise.
 */
export function pickDebugInstrument(
  brokerAccountIds: string[],
  supportedClassesFor: (id: string) => readonly InstrumentClass[],
): { instrumentClass: InstrumentClass; symbol: string } {
  const supported = new Set<InstrumentClass>();
  for (const id of brokerAccountIds) {
    for (const cls of supportedClassesFor(id)) supported.add(cls);
  }
  for (const { instrumentClass, symbol } of DEBUG_DEFAULT_SYMBOLS) {
    if (supported.has(instrumentClass)) {
      return { instrumentClass, symbol };
    }
  }
  throw new AppError(
    "Force trade has no safe default symbol for this session's broker(s). Supported debug classes: crypto (BTC-USD), stock (SPY).",
    "VALIDATION_FAILED",
    { supportedClasses: [...supported] },
  );
}

export class SignalBus {
  private subscriptions = new Map<string, (event: SignalEvent) => void>();

  constructor(
    private readonly eventsRepo: SignalEventsRepo,
    private readonly deliveriesRepo: SignalDeliveriesRepo,
    private readonly deadLettersRepo: SignalDeadLettersRepo,
    private readonly sourcesRepo: SignalSourcesRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly brokerRouting: BrokerRoutingService,
    private readonly eventBus: EventBus,
    private readonly instrumentNormalizer: InstrumentNormalizer,
  ) {}

  register(source: ISignalSource): void {
    const handler = (event: SignalEvent) => {
      void this.handleSignal(event);
    };
    this.subscriptions.set(source.id, handler);
    source.onSignal(handler);
  }

  unregister(sourceId: string, source?: ISignalSource): void {
    const handler = this.subscriptions.get(sourceId);
    if (handler && source) source.offSignal(handler);
    this.subscriptions.delete(sourceId);
  }

  private async handleSignal(event: SignalEvent): Promise<void> {
    const enriched = enrichSignalEvent(event);
    if (
      enriched.dedupeKey &&
      this.eventsRepo.existsBySourceAndDedupeKey(
        enriched.sourceId,
        enriched.dedupeKey,
      )
    ) {
      return;
    }
    // Always check accession too — legacy rows may lack dedupe_key.
    if (
      enriched.accessionNumber &&
      this.eventsRepo.existsBySourceAndAccession(
        enriched.sourceId,
        enriched.accessionNumber,
      )
    ) {
      return;
    }
    try {
      this.eventsRepo.insert(enriched);
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      throw error;
    }
    const sessionIds = this.sourcesRepo.subscribedSessionsForSource(
      enriched.sourceId,
    );
    if (sessionIds.length === 0) {
      this.eventsRepo.markDispatchStatus(
        enriched.id,
        "dropped_pre_fanout",
        "no_subscribers",
      );
      return;
    }
    for (const sessionId of sessionIds) {
      await this.deliverOrDeadLetter(sessionId, enriched);
    }
    this.eventsRepo.markDispatchStatus(enriched.id, "fanned_out");
    this.eventBus.emit("signal_received", {
      signalId: enriched.id,
      sourceId: enriched.sourceId,
      sourceType: enriched.sourceType,
      ticker: enriched.ticker,
      companyName: enriched.companyName,
      detectedAt: enriched.detectedAt,
    });
  }

  async deliverOrDeadLetter(
    sessionId: string,
    event: SignalEvent,
  ): Promise<
    | { kind: "delivery"; deliveryId: string }
    | { kind: "dead_letter"; deadLetterId: string }
  > {
    const session = this.sessionRepo.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    const gate = evaluateSignalDeliveryGate({
      sessionId,
      experienceId: session.experienceId,
      signal: event,
      brokerAssignments:
        this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId),
      brokerAccounts: this.brokerAccountsRepo,
      brokerRouting: this.brokerRouting,
    });

    if (!gate.ok) {
      const deadLetter = this.deadLettersRepo.insert({
        sessionId,
        signalEventId: event.id,
        sourceId: event.sourceId,
        sourceType: event.sourceType,
        ticker: event.ticker,
        instrumentClass: extractSignalInstrumentClass(event),
        reason: gate.reason,
        detail: gate.detail,
      });
      this.eventBus.emit("signal_dead_lettered", {
        deadLetterId: deadLetter.id,
        sessionId,
        signalId: event.id,
        reason: gate.reason,
        ticker: event.ticker,
      });
      return { kind: "dead_letter", deadLetterId: deadLetter.id };
    }

    const isPaused = this.sessionRepo.getStatus(sessionId) === "paused";
    const ttl = event.ttl ?? "PT4H";
    const delivery = this.deliveriesRepo.enqueueWithStatus({
      sessionId,
      signalEventId: event.id,
      sourceId: event.sourceId,
      queuePositionAtEnqueue: this.deliveriesRepo.nextQueuePosition(sessionId),
      status: isPaused ? "waiting_for_resume" : "queued",
      statusBucket: "pending",
      expiresAt: isPaused
        ? signalExpiresAt(event.detectedAt, ttl)
        : null,
    });
    this.eventBus.emit("signal_delivery_updated", {
      deliveryId: delivery.id,
      sessionId,
      signalId: event.id,
      status: delivery.status,
      statusBucket: delivery.statusBucket,
    });
    return { kind: "delivery", deliveryId: delivery.id };
  }

  /**
   * Debug-only: submit a real, minimal order to the session's assigned broker,
   * bypassing the signal pipeline and its delivery gate entirely. This is the
   * end-to-end "does my system actually place orders?" check — it exercises
   * broker routing + adapter + live connectivity, not a synthetic signal.
   *
   * Paper-only: refuses if any assigned broker account is in `live` mode. Does
   * NOT record a Trade row, so the order will appear on the broker but not in
   * the app's trades table.
   */
  async debugForceTrade(sessionId: string): Promise<DebugForceTradeResult> {
    if (!this.sessionRepo.get(sessionId)) {
      throw new AppError(`Session ${sessionId} was not found.`, "NOT_FOUND", {
        sessionId,
      });
    }

    const assignedIds =
      this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId);
    if (assignedIds.length === 0) {
      throw new AppError(
        "No broker is assigned to this session, so there is nothing to send an order to.",
        "VALIDATION_FAILED",
        { sessionId },
      );
    }

    // Paper-only guard: a real order to a live account is never a debug action.
    for (const id of assignedIds) {
      const account = this.brokerAccountsRepo.find(id);
      if (account?.mode === "live") {
        throw new AppError(
          "Force trade is a paper-only debug action, but this session has a live broker assigned.",
          "VALIDATION_FAILED",
          { sessionId, brokerAccountId: id },
        );
      }
    }

    const { instrumentClass, symbol } = pickDebugInstrument(
      assignedIds,
      (id) => this.brokerAccountsRepo.find(id)?.supportedInstrumentClasses ?? [],
    );

    const { adapter, brokerAccountId } = await this.brokerRouting.resolveAdapter(
      sessionId,
      instrumentClass,
    );
    // Re-check after routing in case routing resolved a different account.
    if (this.brokerAccountsRepo.find(brokerAccountId)?.mode === "live") {
      throw new AppError(
        "Force trade resolved to a live broker account; refusing to send a debug order.",
        "VALIDATION_FAILED",
        { sessionId, brokerAccountId },
      );
    }

    const wireSymbol = this.instrumentNormalizer.toBrokerSymbol({
      symbol,
      instrumentClass,
      brokerType: adapter.brokerType,
    });
    const clientOrderId = `debug-force-${crypto.randomUUID()}`;

    const result = await runWithProviderCallScopeAsync({ sessionId }, async () =>
      adapter.placeOrder({
        instrumentSymbol: wireSymbol,
        instrumentDisplayName: null,
        predictionOutcome: null,
        instrumentMetadataJson: null,
        instrumentType: instrumentClass,
        side: "BUY",
        sizeUsd: DEBUG_FORCE_TRADE_SIZE_USD,
        clientOrderId,
      }),
    );

    return {
      brokerType: adapter.brokerType,
      brokerAccountId,
      instrumentClass,
      symbol: wireSymbol,
      side: "BUY",
      sizeUsd: DEBUG_FORCE_TRADE_SIZE_USD,
      brokerOrderId: result.brokerOrderId,
      filledAvgPrice: result.filledAvgPrice,
    };
  }

  injectManual(event: SignalEvent, sessionId: string): void {
    const enriched = enrichSignalEvent(event);
    this.eventsRepo.insert(enriched);
    void this.deliverOrDeadLetter(sessionId, enriched);
    this.eventsRepo.markDispatchStatus(enriched.id, "fanned_out");
    this.eventBus.emit("signal_received", {
      signalId: enriched.id,
      sourceId: enriched.sourceId,
      sourceType: enriched.sourceType,
      ticker: enriched.ticker,
      companyName: enriched.companyName,
      detectedAt: enriched.detectedAt,
    });
  }

  /** Accept a typed MarketSignal (scheduler / new sources) via legacy bridge. */
  async ingestMarketSignal(
    signal: MarketSignal,
    sourceType: SignalSourceType,
  ): Promise<void> {
    await this.handleSignal(marketSignalToLegacyEvent(signal, sourceType));
  }

  emitDeliveryUpdated(payload: {
    deliveryId: string;
    sessionId: string;
    signalId: string;
    status:
      | "queued"
      | "waiting_for_resume"
      | "processing"
      | "triggered"
      | "traded"
      | "rejected"
      | "dropped"
      | "expired";
    statusBucket: "pending" | "completed" | "dropped";
  }): void {
    this.eventBus.emit("signal_delivery_updated", payload);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? error);
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    message.includes("UNIQUE constraint failed")
  );
}
