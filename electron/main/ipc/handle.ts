import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { toIpcError } from "@shared/errors";
import { createLogger } from "../services/infra/log";

const logger = createLogger("ipc");

type Handler<T> = (payload: unknown, event: IpcMainInvokeEvent) => Promise<T> | T;

export function handle<T>(ipcMain: IpcMain, channel: string, handler: Handler<T>): void {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error({ err: error, channel, code: ipcError.code }, "ipc handler failed");
      const wrapped = new Error(ipcError.message);
      (wrapped as Error & { code?: string }).code = ipcError.code;
      throw wrapped;
    }
  });
}
