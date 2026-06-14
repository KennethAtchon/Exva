import type { IpcMainInvokeEvent } from "electron";
import { vi } from "vitest";

const state = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  >();
  const trustedWebContentsId = 1001;
  const mockWebContents = { id: trustedWebContentsId };
  const mockBrowserWindow = { webContents: mockWebContents };
  return {
    handlers,
    trustedWebContentsId,
    mockWebContents,
    mockBrowserWindow,
    windows: [mockBrowserWindow] as Array<{ webContents: { id: number } }>,
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (
          event: IpcMainInvokeEvent,
          payload: unknown,
        ) => Promise<unknown>,
      ) => {
        state.handlers.set(channel, handler);
      },
    ),
    removeHandler: vi.fn((channel: string) => {
      state.handlers.delete(channel);
    }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => state.windows),
  },
}));

export const ipcHarness = {
  get handlers() {
    return state.handlers;
  },
  get trustedWebContentsId() {
    return state.trustedWebContentsId;
  },
  get mockWebContents() {
    return state.mockWebContents;
  },
  get mockBrowserWindow() {
    return state.mockBrowserWindow;
  },
  get windows() {
    return state.windows;
  },
  set windows(value: Array<{ webContents: { id: number } }>) {
    state.windows = value;
  },
};
