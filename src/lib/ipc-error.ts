import type { AppErrorCode } from "@electron/shared/infra/errors";

export type FormattedIpcError = {
  code: AppErrorCode | string;
  message: string;
  /** Operator-facing one-liner: `[CODE] message` */
  display: string;
};

/**
 * Normalize Electron IPC invoke failures. Main attaches `.code` via `toIpcError`;
 * without it we still avoid `[object Object]` toasts.
 */
export function formatIpcError(error: unknown): FormattedIpcError {
  if (error instanceof Error) {
    const code =
      typeof (error as Error & { code?: unknown }).code === "string"
        ? ((error as Error & { code: string }).code as AppErrorCode | string)
        : "UNKNOWN";
    const message = error.message || "Something went wrong";
    return {
      code,
      message,
      display: code === "UNKNOWN" ? message : `[${code}] ${message}`,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code =
      typeof record.code === "string" ? record.code : ("UNKNOWN" as const);
    const message =
      typeof record.message === "string"
        ? record.message
        : "Something went wrong";
    return {
      code,
      message,
      display: code === "UNKNOWN" ? message : `[${code}] ${message}`,
    };
  }

  if (typeof error === "string" && error.trim()) {
    return { code: "UNKNOWN", message: error, display: error };
  }

  return {
    code: "UNKNOWN",
    message: "Something went wrong",
    display: "Something went wrong",
  };
}
