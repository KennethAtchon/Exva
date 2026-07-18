import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { NAV_ITEMS } from "../../src/lib/nav";

export type LaunchedExva = {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
};

function launchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, EXVA_DB_REBUILD_FROM_SCRATCH: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export async function launchExva(): Promise<LaunchedExva> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "exva-e2e-"));
  const packagedApp = path.join(
    process.cwd(),
    "out",
    "exva-darwin-arm64",
    "exva.app",
    "Contents",
    "Resources",
    "app.asar",
  );
  // Packaged app is self-contained (no Vite). Source launch (`.`) needs a
  // running renderer dev server — opt in with EXVA_E2E_SOURCE=1.
  const hasPackagedApp = await fs
    .access(packagedApp)
    .then(() => true)
    .catch(() => false);
  const useSource = process.env.EXVA_E2E_SOURCE === "1" || !hasPackagedApp;
  const app = await electron.launch({
    args: useSource
      ? [".", `--user-data-dir=${userDataDir}`]
      : [packagedApp, `--user-data-dir=${userDataDir}`],
    env: launchEnv(),
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState("domcontentloaded");
  return { app, window, userDataDir };
}

export function navLocator(window: Page) {
  return window.getByRole("navigation", { name: "Main navigation" });
}

export async function navigateToNavItem(
  window: Page,
  label: string,
): Promise<void> {
  const item = NAV_ITEMS.find((entry) => entry.label === label);
  if (!item) {
    throw new Error(`Unknown nav label: ${label}`);
  }

  await navLocator(window)
    .getByRole("button", { name: label, exact: true })
    .click();
}

export async function waitForAppReady(window: Page): Promise<void> {
  await window
    .getByRole("navigation", { name: "Main navigation" })
    .waitFor({ timeout: 30_000 });
  await window
    .getByRole("heading", { name: "Dashboard", level: 1 })
    .waitFor({ state: "visible", timeout: 30_000 });
}

export async function cleanupLaunchedExva(
  launched: LaunchedExva,
): Promise<void> {
  try {
    await launched.app.close();
  } finally {
    await fs.rm(launched.userDataDir, { recursive: true, force: true });
  }
}
