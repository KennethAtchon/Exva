import { BrowserWindow, shell } from "electron";
import path from "node:path";
import type { AppServices } from "./services/app-services";
import { recordRuntimeDiagnostic } from "./services/infra/runtime-diagnostics";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export async function createMainWindow(
  services: AppServices,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: "Exva",
    webPreferences: {
      preload: path.join(__dirname, "index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  services.eventBus.attach(window);

  let unresponsiveAt: number | null = null;
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      recordRuntimeDiagnostic({
        kind: "did_fail_load",
        services,
        severity: isMainFrame ? "ERROR" : "WARN",
        detail: {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
          webContentsId: window.webContents.id,
        },
      });
    },
  );
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    recordRuntimeDiagnostic({
      kind: "preload_error",
      services,
      detail: {
        preloadFile: path.basename(preloadPath),
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack ?? null,
        webContentsId: window.webContents.id,
      },
    });
  });
  window.on("unresponsive", () => {
    unresponsiveAt = Date.now();
    recordRuntimeDiagnostic({
      kind: "window_unresponsive",
      services,
      detail: { webContentsId: window.webContents.id },
    });
  });
  window.on("responsive", () => {
    recordRuntimeDiagnostic({
      kind: "window_responsive",
      services,
      severity: "INFO",
      detail: {
        webContentsId: window.webContents.id,
        unresponsiveForMs:
          unresponsiveAt == null ? null : Date.now() - unresponsiveAt,
      },
    });
    unresponsiveAt = null;
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return window;
}
