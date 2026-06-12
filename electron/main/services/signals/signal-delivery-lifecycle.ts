import type { SessionSignalDelivery } from "@electron/shared/domain";
import type { EventBus } from "../infra/event-bus";
import type { SignalDeliveriesRepo } from "./repos/signal-deliveries-repo";

export type TerminalDeliveryStatus = Extract<
  SessionSignalDelivery["status"],
  "traded" | "rejected" | "dropped" | "expired"
>;

export class SignalDeliveryLifecycle {
  constructor(
    private readonly deliveries: SignalDeliveriesRepo,
    private readonly eventBus: EventBus,
  ) {}

  complete(
    deliveryId: string,
    input: {
      sessionId: string;
      signalId: string;
      status: TerminalDeliveryStatus;
      tradeId?: string | null;
      dropReason?: string | null;
    },
  ): void {
    const existing = this.deliveries.getDetailedById(deliveryId);
    if (!existing) return;
    if (
      existing.delivery.status !== "processing" &&
      existing.delivery.status !== "queued"
    ) {
      return;
    }

    const statusBucket =
      input.status === "traded" ? "completed" : ("dropped" as const);
    const finishedAt = new Date().toISOString();

    this.deliveries.updateStatus(deliveryId, {
      status: input.status,
      statusBucket,
      finishedAt,
      tradeId: input.tradeId ?? null,
      dropReason: input.dropReason ?? null,
    });

    this.eventBus.emit("signal_delivery_updated", {
      deliveryId,
      sessionId: input.sessionId,
      signalId: input.signalId,
      status: input.status,
      statusBucket,
    });
  }

  expireIfStillProcessing(
    deliveryId: string,
    sessionId: string,
    signalId: string,
    dropReason: string,
  ): void {
    const existing = this.deliveries.getDetailedById(deliveryId);
    if (!existing || existing.delivery.status !== "processing") return;
    this.complete(deliveryId, {
      sessionId,
      signalId,
      status: "expired",
      dropReason,
    });
  }
}
