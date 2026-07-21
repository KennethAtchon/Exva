import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import { logProviderCall } from "../infra/provider-call-log";

export type BrokerCallStatus = "ok" | "error" | "empty" | "partial";

export interface BrokerInteractionLogger {
  log(input: {
    callType: string;
    endpoint: string;
    latencyMs: number;
    status: BrokerCallStatus;
  }): void;
}

export function createBrokerInteractionLogger(input: {
  apiCallLogRepo: ApiCallLogRepo;
  brokerAccountId: string;
  provider: string;
}): BrokerInteractionLogger {
  return {
    log({ callType, endpoint, latencyMs, status }) {
      logProviderCall({
        apiCallLogRepo: input.apiCallLogRepo,
        provider: input.provider,
        callType,
        endpoint: `${input.brokerAccountId}/${endpoint}`,
        latencyMs,
        status,
      });
    },
  };
}

export async function traceBrokerInteraction<T>(
  logger: BrokerInteractionLogger | undefined,
  callType: string,
  endpoint: string,
  fn: () => Promise<T>,
  options?: {
    resolveStatus?: (result: T) => BrokerCallStatus;
  },
): Promise<T> {
  if (!logger) return fn();

  const startedAt = Date.now();
  const log = (status: BrokerCallStatus) =>
    logger.log({
      callType,
      endpoint,
      latencyMs: Date.now() - startedAt,
      status,
    });

  try {
    const result = await fn();
    log(options?.resolveStatus?.(result) ?? "ok");
    return result;
  } catch (error) {
    log("error");
    throw error;
  }
}

/** OHLCV readiness: promise-resolved alone is not a successful bar fetch. */
export function resolveOhlcvCallStatus(
  bars: { length: number },
  barCount: number,
): BrokerCallStatus {
  if (bars.length === 0) return "empty";
  if (bars.length < barCount) return "partial";
  return "ok";
}

export function formatPlaceOrderEndpoint(order: {
  side: string;
  instrumentSymbol: string;
  instrumentType: string;
  sizeUsd: number;
  clientOrderId?: string;
}): string {
  const clientSuffix = order.clientOrderId
    ? `/${order.clientOrderId.slice(0, 36)}`
    : "";
  return `placeOrder/${order.side}/${order.instrumentSymbol}/${order.instrumentType}/$${order.sizeUsd.toFixed(2)}${clientSuffix}`;
}

export function inferAlpacaHttpCallType(method: string, path: string): string {
  const upper = method.toUpperCase();
  if (upper === "POST" && path === "/v2/orders") return "placeOrder_submit";
  if (upper === "DELETE" && /\/v2\/orders\//.test(path))
    return "cancelOrder_submit";
  if (upper === "DELETE" && /\/v2\/positions\//.test(path))
    return "closePosition_submit";
  if (upper === "GET" && /\/v2\/orders\//.test(path))
    return "order_status_poll";
  return "broker_http";
}
