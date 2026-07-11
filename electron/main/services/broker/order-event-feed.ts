import type { BrokerAdapter } from "./adapters/broker-adapter";
import type { OrderEvent, OrderEventFeed } from "./order-contract-v2";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Poll-based OrderEventFeed default. Calls getOrderStatus on the given order
 * ids and emits fill/canceled once each order reaches a terminal closed state.
 * Adapters with websockets can replace this with a streaming feed.
 */
export function createPollOrderEventFeed(
  adapter: BrokerAdapter,
  orderIds: readonly string[],
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): OrderEventFeed {
  const handlers = new Set<(event: OrderEvent) => void>();
  const pending = new Set(orderIds);
  const emitted = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  const emit = (event: OrderEvent): void => {
    for (const handler of handlers) {
      handler(event);
    }
  };

  const tick = async (): Promise<void> => {
    if (polling || pending.size === 0) return;
    polling = true;
    try {
      for (const orderId of [...pending]) {
        if (emitted.has(orderId)) {
          pending.delete(orderId);
          continue;
        }
        let status;
        try {
          status = await adapter.getOrderStatus(orderId);
        } catch {
          continue;
        }
        if (status.status !== "closed") continue;

        const kind: OrderEvent["kind"] =
          status.latestPrice != null && status.latestPrice > 0
            ? "fill"
            : "canceled";
        const event: OrderEvent = {
          brokerOrderId: status.brokerOrderId || orderId,
          kind,
          ts: new Date().toISOString(),
          filledAvgPrice: status.latestPrice ?? undefined,
          realizedPnlUsd: status.realizedPnlUsd ?? undefined,
        };
        emitted.add(orderId);
        pending.delete(orderId);
        emit(event);
      }
    } finally {
      polling = false;
      if (pending.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };

  return {
    async start() {
      if (timer || pending.size === 0) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      void tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      handlers.clear();
      pending.clear();
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
