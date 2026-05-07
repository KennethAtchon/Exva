import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { toIpcError } from "@shared/errors";
import { createLogger } from "../services/infra/log";
import { payloadMeta } from "../services/infra/log-safety";

const logger = createLogger("ipc");

type Handler<T> = (payload: unknown, event: IpcMainInvokeEvent) => Promise<T> | T;

export function handle<T>(ipcMain: IpcMain, channel: string, handler: Handler<T>): void {
  ipcMain.handle(channel, async (event, payload) => {
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
      const result = await handler(payload, event);
      logger.debug({ channel, durationMs: Date.now() - startedAt }, "ipc invoke success");
      return result;
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error(
        { err: error, channel, code: ipcError.code, durationMs: Date.now() - startedAt },
        "ipc handler failed",
      );
      const wrapped = new Error(ipcError.message);
      // reason: Electron only serializes plain Error across the context bridge; we attach code so the renderer can distinguish error types without message-matching
      (wrapped as Error & { code?: string }).code = ipcError.code;
      throw wrapped;
    }
  });
}
