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
  /**
   * Detect the broker's protocol-level auth/subscription acknowledgment in a
   * raw message. A TCP `open` only proves the socket connected, not that the
   * venue authenticated us or accepted the subscription; a rejected/garbled
   * handshake can still open a socket and then close it immediately. The feed
   * is only counted healthy — and the reconnect backoff only resets — once
   * this returns true, so a broker that never truly authenticates exhausts
   * `maxReconnectAttempts` and falls back to poll instead of reconnecting
   * forever at attempt zero.
   */
  isProtocolAck: (raw: WebSocket.RawData) => boolean;
  /** Adapter used for poll fallback after N failed reconnects. */
  adapter: BrokerAdapter;
  pollIntervalMs?: number;
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff (ms). */
  reconnectBaseMs?: number;
  /** Invoked when the feed falls back to poll after reconnect exhaustion. */
  onFallbackToPoll?: (reason: string) => void;
  /** Heartbeat / ping interval; 0 disables. Defaults to 30s. */
  pingIntervalMs?: number;
  /** Max ms to wait for the protocol ack after socket `open`. Defaults to 10s. */
  authAckTimeoutMs?: number;
  /** Max ms to wait for a `pong` after a ping before treating the connection as dead. Defaults to 2x pingIntervalMs (floor 10s). */
  pongTimeoutMs?: number;
  /** Notified whenever protocol health flips: true only after ack, false on any disconnect/failure. */
  onHealthChange?: (healthy: boolean) => void;
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
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  const authAckTimeoutMs = options.authAckTimeoutMs ?? 10_000;
  const pongTimeoutMs =
    options.pongTimeoutMs ?? Math.max(pingIntervalMs * 2, 10_000);
  const watched = new Set<string>();

  let socket: WebSocket | null = null;
  let stopped = true;
  let reconnectAttempts = 0;
  let acked = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let authAckTimer: ReturnType<typeof setTimeout> | null = null;
  let pollFallback: OrderEventFeed | null = null;
  let usingPoll = false;

  const emit = (event: OrderEvent): void => {
    for (const handler of handlers) handler(event);
  };

  const setHealthy = (healthy: boolean): void => {
    options.onHealthChange?.(healthy);
  };

  const clearPing = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongDeadlineTimer) {
      clearTimeout(pongDeadlineTimer);
      pongDeadlineTimer = null;
    }
  };

  const clearAuthAckTimer = (): void => {
    if (authAckTimer) {
      clearTimeout(authAckTimer);
      authAckTimer = null;
    }
  };

  const startPollFallback = (reason: string): void => {
    if (usingPoll) return;
    usingPoll = true;
    setHealthy(false);
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

  /** Force-close the current socket after a protocol-level failure (no ack, no pong) and count it as a failed reconnect attempt. */
  const terminateForFailure = (reason: string): void => {
    logger.warn({ reason }, "order event feed protocol check failed");
    clearPing();
    clearAuthAckTimer();
    const sock = socket;
    socket = null;
    acked = false;
    setHealthy(false);
    if (sock) {
      sock.removeAllListeners();
      sock.once("error", () => undefined);
      try {
        sock.terminate();
      } catch {
        /* ignore */
      }
    }
    if (!stopped && !usingPoll) scheduleReconnect();
  };

  const armPongDeadline = (): void => {
    if (pongDeadlineTimer) clearTimeout(pongDeadlineTimer);
    pongDeadlineTimer = setTimeout(() => {
      terminateForFailure(`no pong within ${pongTimeoutMs}ms`);
    }, pongTimeoutMs);
  };

  const startHeartbeat = (): void => {
    if (!(pingIntervalMs > 0)) return;
    clearPing();
    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.ping();
        armPongDeadline();
      }
    }, pingIntervalMs);
  };

  const connect = (): void => {
    if (stopped || usingPoll) return;
    acked = false;
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
      const opened = socket;
      if (opened) options.onOpen?.(opened);
      clearAuthAckTimer();
      authAckTimer = setTimeout(() => {
        terminateForFailure(`no protocol ack within ${authAckTimeoutMs}ms`);
      }, authAckTimeoutMs);
    });

    socket.on("message", (data) => {
      if (!acked && options.isProtocolAck(data)) {
        acked = true;
        clearAuthAckTimer();
        reconnectAttempts = 0;
        setHealthy(true);
        startHeartbeat();
      }
      try {
        const events = options.mapMessage(data);
        for (const event of events) emit(event);
      } catch (err) {
        logger.warn({ err }, "order event feed message map failed");
      }
    });

    socket.on("pong", () => {
      if (pongDeadlineTimer) {
        clearTimeout(pongDeadlineTimer);
        pongDeadlineTimer = null;
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err }, "order event feed websocket error");
      clearPing();
      clearAuthAckTimer();
    });

    socket.on("close", () => {
      clearPing();
      clearAuthAckTimer();
      socket = null;
      acked = false;
      setHealthy(false);
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
      clearAuthAckTimer();
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
