import type { EventBus } from "../infra/event-bus";
import type { SignalEvent } from "@electron/shared/domain";
import { extractSignalInstrumentClass } from "@electron/shared/domain/signal-source-capabilities";
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
    if (
      event.accessionNumber &&
      this.eventsRepo.existsBySourceAndAccession(
        event.sourceId,
        event.accessionNumber,
      )
    ) {
      return;
    }
    this.eventsRepo.insert(event);
    const sessionIds = this.sourcesRepo.subscribedSessionsForSource(
      event.sourceId,
    );
    if (sessionIds.length === 0) {
      this.eventsRepo.markDispatchStatus(
        event.id,
        "dropped_pre_fanout",
        "no_subscribers",
      );
      return;
    }
    for (const sessionId of sessionIds) {
      await this.deliverOrDeadLetter(sessionId, event);
    }
    this.eventsRepo.markDispatchStatus(event.id, "fanned_out");
    this.eventBus.emit("signal_received", {
      signalId: event.id,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      ticker: event.ticker,
      companyName: event.companyName,
      detectedAt: event.detectedAt,
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
    const delivery = this.deliveriesRepo.enqueueWithStatus({
      sessionId,
      signalEventId: event.id,
      sourceId: event.sourceId,
      queuePositionAtEnqueue: this.deliveriesRepo.nextQueuePosition(sessionId),
      status: isPaused ? "waiting_for_resume" : "queued",
      statusBucket: "pending",
      expiresAt: isPaused
        ? new Date(
            Date.parse(event.detectedAt) + 4 * 60 * 60 * 1000,
          ).toISOString()
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

  injectManual(event: SignalEvent, sessionId: string): void {
    this.eventsRepo.insert(event);
    void this.deliverOrDeadLetter(sessionId, event);
    this.eventsRepo.markDispatchStatus(event.id, "fanned_out");
    this.eventBus.emit("signal_received", {
      signalId: event.id,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      ticker: event.ticker,
      companyName: event.companyName,
      detectedAt: event.detectedAt,
    });
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
