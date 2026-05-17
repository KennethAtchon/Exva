export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "LOCKED"
  | "NOT_FOUND"
  | "PROVIDER_NOT_CONFIGURED"
  | "MISSING_SECRET"
  | "BROKER_UNREACHABLE"
  | "BROKER_ERROR"
  | "ROUTING_AMBIGUOUS"
  | "NO_BROKER"
  | "UNSUPPORTED_INSTRUMENT"
  | "UNKNOWN_BROKER"
  | "SESSION_NOT_ACTIVE"
  | "SELECTOR_NOT_CONFIGURED"
  | "SEARCH_PROVIDER_REQUIRED"
  | "PROVIDER_UNREACHABLE"
  | "INSTRUMENT_CONFLICT"
  | "CAPITAL_POOL_EXCEEDED"
  | "PREFLIGHT_FAILED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
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
