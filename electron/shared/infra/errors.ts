export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "LOCKED"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "PROVIDER_NOT_CONFIGURED"
  | "MISSING_SECRET"
  | "BROKER_UNREACHABLE"
  | "BROKER_ERROR"
  | "BROKER_AUTH"
  | "BROKER_INSUFFICIENT_FUNDS"
  | "BROKER_UNKNOWN_SYMBOL"
  | "BROKER_REJECTED"
  | "BROKER_RATE_LIMIT"
  | "BROKER_DATA"
  | "INVALID_PAYLOAD"
  | "MARKET_CLOSED"
  | "ROUTING_AMBIGUOUS"
  | "NO_BROKER"
  | "UNSUPPORTED_INSTRUMENT"
  | "UNKNOWN_BROKER"
  | "SESSION_NOT_ACTIVE"
  | "OPEN_TRADES_BLOCK_STOP"
  | "SELECTOR_NOT_CONFIGURED"
  | "SEARCH_PROVIDER_REQUIRED"
  | "PROVIDER_UNREACHABLE"
  | "INSTRUMENT_CONFLICT"
  | "BROKER_SESSION_CAP_EXCEEDED"
  | "BROKER_ALLOCATION_EXCEEDED"
  | "CAPITAL_POOL_EXCEEDED"
  | "PREFLIGHT_FAILED"
  | "SPEND_CAP_EXCEEDED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "MODEL_OUTPUT_INVALID"
  | "BROKER_NOT_FOUND"
  // Paper order-path certification (Solution 01). Each names the exact gate
  // that refused, so a blocked run is reportable without log spelunking.
  | "CERT_LIVE_WORKSPACE"
  | "CERT_LIVE_SESSION"
  | "CERT_LIVE_BROKER"
  | "CERT_KILL_SWITCH"
  | "CERT_MARKET_CLOSED"
  | "CERT_DAILY_LIMIT"
  | "CERT_BROKER_UNREACHABLE"
  | "CERT_ADAPTER_INCOMPLETE"
  | "UNKNOWN";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode = "UNKNOWN",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface SerializedAppError {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function serializeError(error: unknown): SerializedAppError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message || "Internal error" };
  }

  return { code: "UNKNOWN", message: "Internal error" };
}

export type IpcErrorResponse = SerializedAppError;

export function toIpcError(error: unknown): IpcErrorResponse {
  return serializeError(error);
}
