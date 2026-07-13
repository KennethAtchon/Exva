import WebSocket from "ws";
import type { OrderEvent, OrderEventFeed } from "./order-contract-v2";
import { createPollOrderEventFeed } from "./order-event-feed";
import type { BrokerAdapter } from "./adapters/broker-adapter";
import { createLogger } from "../infra/log";

const logger = createLogger("streaming-order-event-feed");

export interface StreamingOrderEventFeedOptions {
  /** WebSocket URL. */
  url: string;
  /** Optional handshake headers (Kalshi RSA auth). */
  headers?: Record<string, string>;
  /** Called after the socket opens (e.g. Alpaca auth + listen messages). */
  onOpen?: (socket: WebSocket) => void;
  /** Parse a raw WS message into zero or more OrderEvents. */
  mapMessage: (raw: WebSocket.RawData) => OrderEvent[];
  /** Adapter used for poll fallback after N failed reconnects. */
  adapter: BrokerAdapter;
  pollIntervalMs?: number;
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff (ms). */
  reconnectBaseMs?: number;
  /** Invoked when the feed falls back to poll after reconnect exhaustion. */
  onFallbackToPoll?: (reason: string) => void;
  /** Heartbeat / ping interval; 0 disables. */
  pingIntervalMs?: number;
}

/**
 * WebSocket OrderEventFeed with exponential-backoff reconnect and automatic
 * poll fallback after maxReconnectAttempts consecutive failures.
 */
export function createStreamingOrderEventFeed(
  options: StreamingOrderEventFeedOptions,
): OrderEventFeed {
  const handlers = new Set<(event: OrderEvent) => void>();
  const maxAttempts = options.maxReconnectAttempts ?? 5;
  const baseMs = options.reconnectBaseMs ?? 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const watched = new Set<string>();

  let socket: WebSocket | null = null;
  let stopped = true;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pollFallback: OrderEventFeed | null = null;
  let usingPoll = false;

  const emit = (event: OrderEvent): void => {
    for (const handler of handlers) handler(event);
  };

  const clearPing = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const startPollFallback = (reason: string): void => {
    if (usingPoll) return;
    usingPoll = true;
    logger.warn({ reason }, "order event feed falling back to poll");
    options.onFallbackToPoll?.(reason);
    pollFallback = createPollOrderEventFeed(
      options.adapter,
      [...watched],
      pollIntervalMs,
    );
    for (const handler of handlers) {
      pollFallback.onEvent(handler);
    }
    void pollFallback.start();
  };

  const scheduleReconnect = (): void => {
    if (stopped || usingPoll) return;
    if (reconnectAttempts >= maxAttempts) {
      startPollFallback(
        `websocket reconnect failed after ${maxAttempts} attempts`,
      );
      return;
    }
    const delay = Math.min(60_000, baseMs * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    logger.info(
      { attempt: reconnectAttempts, delay },
      "order event feed reconnecting",
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = (): void => {
    if (stopped || usingPoll) return;
    try {
      socket = new WebSocket(options.url, {
        headers: options.headers,
      });
    } catch (err) {
      logger.error({ err }, "order event feed websocket construct failed");
      scheduleReconnect();
      return;
    }

    socket.on("open", () => {
      reconnectAttempts = 0;
      const opened = socket;
      if (opened) options.onOpen?.(opened);
      clearPing();
      if (options.pingIntervalMs && options.pingIntervalMs > 0) {
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.ping();
          }
        }, options.pingIntervalMs);
      }
    });

    socket.on("message", (data) => {
      try {
        const events = options.mapMessage(data);
        for (const event of events) emit(event);
      } catch (err) {
        logger.warn({ err }, "order event feed message map failed");
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err }, "order event feed websocket error");
    });

    socket.on("close", () => {
      clearPing();
      socket = null;
      if (!stopped && !usingPoll) scheduleReconnect();
    });
  };

  return {
    async start() {
      stopped = false;
      usingPoll = false;
      connect();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearPing();
      if (socket) {
        const sock = socket;
        socket = null;
        sock.removeAllListeners();
        sock.once("error", () => undefined);
        try {
          sock.terminate();
        } catch {
          /* ignore */
        }
      }
      if (pollFallback) {
        await pollFallback.stop();
        pollFallback = null;
      }
      handlers.clear();
      watched.clear();
    },
    onEvent(handler) {
      handlers.add(handler);
      pollFallback?.onEvent(handler);
      return () => handlers.delete(handler);
    },
    watchOrders(orderIds) {
      for (const id of orderIds) watched.add(id);
      pollFallback?.watchOrders?.(orderIds);
    },
  };
}
