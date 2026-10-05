// Exva desktop shell. Thin on purpose: start (or attach to) the engine, show its UI, and do the
// desktop-only jobs: tray, launch at login, keep the computer awake, notifications.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  nativeImage,
  powerSaveBlocker,
  shell,
  Tray,
} from "electron";

const root = app.getAppPath(); // repo root in development
const assets = app.isPackaged ? process.resourcesPath : join(root, "desktop", "assets");
const home = process.env.EXVA_HOME ?? join(homedir(), ".exva");
const PORT = Number(process.env.EXVA_PORT ?? 7420);

interface Engine {
  port: number;
  token: string;
  child: ChildProcess | null; // null when we attached to an engine started elsewhere
}

interface StatusLite {
  health: "ok" | "warn" | "error";
  botsRunning: number;
  killSwitch: boolean;
  accounts: { name: string; ok: boolean }[];
}

interface SettingsLite {
  app: {
    launchAtLogin: boolean;
    keepRunningInTray: boolean;
    preventSleep: boolean;
    notifications: boolean;
  };
}

let engine: Engine | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let blocker: number | null = null;
let settings: SettingsLite | null = null;
let restarts: number[] = [];

const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  if (!engine) throw new Error("engine not started");
  const res = await fetch(`http://127.0.0.1:${engine.port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${engine.token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
};

/** Reuse a running engine (e.g. started with `bun run engine`), otherwise start one. */
async function startEngine(): Promise<Engine> {
  try {
    const file = JSON.parse(readFileSync(join(home, "engine.json"), "utf8")) as {
      port: number;
      token: string;
    };
    engine = { port: file.port, token: file.token, child: null };
    await api("/api/status");
    return engine;
  } catch {
    engine = null;
  }
  const token = randomUUID();
  const env = { ...process.env, EXVA_TOKEN: token, EXVA_PORT: String(PORT) };
  const child = app.isPackaged
    ? spawn(
        join(process.resourcesPath, "exva-engine"),
        ["run", "--ui", join(process.resourcesPath, "ui")],
        { env, stdio: "inherit" },
      )
    : spawn(process.env.EXVA_BUN ?? "bun", [join(root, "engine", "src", "cli.ts"), "run"], {
        env,
        stdio: "inherit",
        cwd: root,
      });
  engine = { port: PORT, token, child };
  child.on("exit", (code) => {
    if (quitting || engine?.child !== child) return;
    restarts = [...restarts.filter((t) => Date.now() - t < 60_000), Date.now()];
    if (restarts.length > 3) {
      dialog.showErrorBox(
        "Exva engine keeps crashing",
        `The engine exited with code ${code} several times in a minute. Check the terminal output.`,
      );
      return;
    }
    notify("Engine restarted", "The trading engine stopped unexpectedly and was restarted.");
    setTimeout(() => startEngine().then(() => win?.reload()), 2000);
  });
  for (let i = 0; i < 150; i++) {
    try {
      await api("/api/status");
      return engine;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("The engine did not start within 30 seconds.");
}

function createWindow(): void {
  if (!engine) return;
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    title: "Exva",
    backgroundColor: "#131311",
    icon: join(assets, "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${engine.port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    if (quitting || !settings?.app.keepRunningInTray) return;
    e.preventDefault(); // keep trading from the menu bar
    win?.hide();
  });
  win.on("closed", () => {
    win = null;
  });
}

function showWindow(): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

/** A 16px dot in the health color, drawn as raw BGRA pixels (no image assets needed). */
function dot(color: [number, number, number]): Electron.NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      const alpha = Math.max(0, Math.min(1, 11 - d));
      const i = (y * size + x) * 4;
      buf[i] = color[2];
      buf[i + 1] = color[1];
      buf[i + 2] = color[0];
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

const DOTS = { ok: dot([74, 222, 128]), warn: dot([233, 180, 76]), error: dot([244, 101, 95]) };

function updateTray(status: StatusLite | null): void {
  if (!tray) return;
  const health = status ? (status.killSwitch ? "error" : status.health) : "error";
  tray.setImage(DOTS[health]);
  const line = status
    ? status.killSwitch
      ? "Trading stopped (kill switch)"
      : `${status.botsRunning} bot(s) running · ${status.health === "ok" ? "all good" : status.health}`
    : "Engine not reachable";
  tray.setToolTip(`Exva: ${line}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: line, enabled: false },
      { type: "separator" },
      { label: "Open Exva", click: showWindow },
      status?.killSwitch
        ? {
            label: "Resume trading",
            click: () =>
              api("/api/kill-switch", { method: "POST", body: JSON.stringify({ on: false }) }).then(
                poll,
              ),
          }
        : {
            label: "Pause all bots (kill switch)",
            click: () =>
              api("/api/kill-switch", { method: "POST", body: JSON.stringify({ on: true }) }).then(
                poll,
              ),
          },
      { type: "separator" },
      { label: "Quit Exva", click: () => app.quit() },
    ]),
  );
}

/** Apply desktop settings and refresh the tray. */
async function poll(): Promise<void> {
  let status: StatusLite | null = null;
  try {
    [status, settings] = await Promise.all([
      api<StatusLite>("/api/status"),
      api<SettingsLite>("/api/settings"),
    ]);
  } catch {}
  updateTray(status);
  if (!settings) return;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.app.launchAtLogin });
  const keepAwake = settings.app.preventSleep && (status?.botsRunning ?? 0) > 0;
  if (keepAwake && blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension");
  if (!keepAwake && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

function notify(title: string, body: string): void {
  if (settings?.app.notifications === false || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on("click", showWindow);
  n.show();
}

const NOTIFY_KINDS = new Set([
  "fill",
  "sleep_gap",
  "position_drift",
  "engine_error",
  "data_error",
  "kill_switch",
  "journal",
]);

/** Listen to engine events for notifications. Reconnects when the engine restarts. */
function listen(): void {
  if (!engine) return;
  const ws = new WebSocket(`ws://127.0.0.1:${engine.port}/api/ws?token=${engine.token}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as {
      type: string;
      data: { kind: string; level: string; message: string };
    };
    if (msg.type === "status") poll();
    if (msg.type !== "event" || !NOTIFY_KINDS.has(msg.data.kind)) return;
    if (msg.data.kind === "journal")
      notify("Your morning journal is ready", "Open Exva to read what your bots did.");
    else notify(msg.data.level === "info" ? "Exva" : "Exva needs attention", msg.data.message);
  };
  ws.onclose = () => {
    if (!quitting) setTimeout(listen, 3000);
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(async () => {
    try {
      await startEngine();
    } catch (err) {
      dialog.showErrorBox("Exva could not start", String(err));
      app.exit(1);
      return;
    }
    if (process.platform === "darwin" && existsSync(join(assets, "icon-dock.png")))
      app.dock?.setIcon(join(assets, "icon-dock.png"));
    tray = new Tray(DOTS.ok);
    await poll();
    createWindow();
    listen();
    setInterval(poll, 15_000);
  });
  app.on("activate", showWindow);
  app.on("window-all-closed", () => {
    if (!settings?.app.keepRunningInTray) app.quit();
  });
  app.on("before-quit", async (e) => {
    if (quitting) return;
    if (engine?.child) {
      e.preventDefault();
      const status = await api<StatusLite>("/api/status").catch(() => null);
      if (status && status.botsRunning > 0) {
        const { response } = await dialog.showMessageBox({
          type: "question",
          buttons: ["Quit and stop bots", "Keep running"],
          defaultId: 1,
          message: `${status.botsRunning} bot(s) are running. Quitting Exva stops all trading.`,
        });
        if (response === 1) return;
      }
      quitting = true;
      engine.child.kill("SIGTERM");
      app.quit();
    } else {
      quitting = true;
    }
  });
}
