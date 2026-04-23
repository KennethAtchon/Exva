export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = "APP_ERROR",
    public readonly safeMessage = message,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface IpcErrorResponse {
  code: string;
  message: string;
}

export function toIpcError(error: unknown): IpcErrorResponse {
  if (error instanceof AppError) {
    return { code: error.code, message: error.safeMessage };
  }

  if (error instanceof Error) {
    return { code: "APP_ERROR", message: error.message || "Unexpected application error" };
  }

  return { code: "APP_ERROR", message: "Unexpected application error" };
}
