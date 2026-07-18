import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { BrowserWindow } from "electron";
import { AppError, toIpcError } from "@shared/infra/errors";
import type { z } from "zod";
import { createLogger } from "../services/infra/log";
import { payloadMeta } from "../services/infra/log-safety";

const logger = createLogger("ipc");

type Handler<TIn, TOut> = (
  payload: TIn,
  event: IpcMainInvokeEvent,
) => Promise<TOut> | TOut;

/**
 * Verify the IPC invocation came from our own renderer window — not from a
 * child frame, embedded iframe, or unexpected webContents. This is Electron's
 * recommended last-mile hardening for privileged handlers.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  // Reject calls from sub-frames; main world only.
  if (event.senderFrame && event.senderFrame.parent !== null) return false;
  const sender = event.sender;
  // Reject calls from webContents that aren't one of our own BrowserWindows.
  const ownedByWindow = BrowserWindow.getAllWindows().some(
    (win) => win.webContents.id === sender.id,
  );
  return ownedByWindow;
}

/**
 * Register an IPC invoke handler with Zod payload validation at the boundary.
 * Schema is required so new channels cannot forget validation.
 */
export function handle<TSchema extends z.ZodType, TOut>(
  ipcMain: IpcMain,
  channel: string,
  schema: TSchema,
  handler: Handler<z.infer<TSchema>, TOut>,
): void {
  ipcMain.handle(channel, async (event, payload) => {
    if (!isTrustedSender(event)) {
      logger.warn(
        { channel, senderId: event.sender.id },
        "rejecting IPC from untrusted sender",
      );
      throw new Error("Untrusted IPC sender");
    }
    const startedAt = Date.now();
    const meta = payloadMeta(payload);
    logger.debug(
      {
        channel,
        hasPayload: payload !== undefined,
        payloadSizeBytes: meta.sizeBytes,
        payloadTooLarge: meta.tooLarge,
        sensitiveKeyDetected: meta.sensitiveKeyDetected,
        sensitiveKeyCount: meta.sensitiveKeyCount,
      },
      "ipc invoke start",
    );
    try {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new AppError("Invalid IPC payload", "INVALID_PAYLOAD", {
          channel,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const result = await handler(parsed.data, event);
      logger.debug(
        { channel, durationMs: Date.now() - startedAt },
        "ipc invoke success",
      );
      return result;
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error(
        {
          err: error,
          channel,
          code: ipcError.code,
          durationMs: Date.now() - startedAt,
        },
        "ipc handler failed",
      );
      const wrapped = new Error(ipcError.message);
      // reason: Electron only serializes plain Error across the context bridge; we attach code so the renderer can distinguish error types without message-matching
      (wrapped as Error & { code?: string }).code = ipcError.code;
      throw wrapped;
    }
  });
}
