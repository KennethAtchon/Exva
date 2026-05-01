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
  | "SESSION_NOT_ACTIVE"
  | "SELECTOR_NOT_CONFIGURED"
  | "SEARCH_PROVIDER_REQUIRED"
  | "INSTRUMENT_CONFLICT"
  | "CAPITAL_POOL_EXCEEDED"
  | "UNKNOWN";

export interface IpcErrorResponse {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function toIpcError(error: unknown): IpcErrorResponse {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message || "Internal error" };
  }

  return { code: "UNKNOWN", message: "Internal error" };
}
