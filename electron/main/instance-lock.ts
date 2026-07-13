/**
 * Single-instance handoff between headless and GUI (doc 04 T4).
 *
 * Design choice (documented): when the GUI launches while headless holds the
 * lock, GUI signals headless to exit via the lockfile + SIGTERM on the recorded
 * pid, waits briefly, then takes the lock. If takeover fails, GUI refuses to
 * start with a clear error (fallback: "Stop Headless" via uninstall-launchd /
 * kill). Headless never steals the lock from a live GUI.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "./config/env";
import { createLogger } from "./services/infra/log";

const logger = createLogger("instance-lock");

export const LOCK_DIR = path.join(os.homedir(), ".exva");
export const LOCK_PATH = path.join(LOCK_DIR, "instance.lock");

export type InstanceMode = "gui" | "headless";

/** Headless when EXVA_HEADLESS=1/true or argv contains --headless. */
export function isHeadlessMode(): boolean {
  if (env.headless) return true;
  return process.argv.includes("--headless");
}

export interface InstanceLockPayload {
  pid: number;
  mode: InstanceMode;
  startedAt: string;
}

export function readInstanceLock(): InstanceLockPayload | null {
  try {
    if (!fs.existsSync(LOCK_PATH)) return null;
    const raw = JSON.parse(
      fs.readFileSync(LOCK_PATH, "utf8"),
    ) as InstanceLockPayload;
    if (!raw.pid || !raw.mode) return null;
    return raw;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeInstanceLock(mode: InstanceMode): void {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const payload: InstanceLockPayload = {
    pid: process.pid,
    mode,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

export function clearInstanceLock(): void {
  try {
    const existing = readInstanceLock();
    if (existing && existing.pid === process.pid) {
      fs.rmSync(LOCK_PATH, { force: true });
    }
  } catch {
    // Best-effort.
  }
}

/**
 * Acquire the single-instance lock.
 * - Headless: fails if GUI is already running.
 * - GUI: signals a live headless instance to exit, then takes over.
 */
export async function acquireInstanceLock(
  mode: InstanceMode,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = readInstanceLock();
  if (existing && processAlive(existing.pid) && existing.pid !== process.pid) {
    if (mode === "headless" && existing.mode === "gui") {
      return {
        ok: false,
        reason: `GUI already running (pid ${existing.pid}). Stop the app before starting headless.`,
      };
    }
    if (mode === "gui" && existing.mode === "headless") {
      logger.info(
        { headlessPid: existing.pid },
        "GUI taking over from headless — signaling headless to exit",
      );
      try {
        process.kill(existing.pid, "SIGTERM");
      } catch (err) {
        return {
          ok: false,
          reason: `Failed to signal headless pid ${existing.pid}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        if (!processAlive(existing.pid)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (processAlive(existing.pid)) {
        return {
          ok: false,
          reason: `Headless pid ${existing.pid} did not exit after SIGTERM. Run scripts/uninstall-launchd.sh or kill it, then retry.`,
        };
      }
    } else if (existing.mode === mode) {
      return {
        ok: false,
        reason: `Another Exva ${mode} instance is already running (pid ${existing.pid}).`,
      };
    }
  }

  writeInstanceLock(mode);
  return { ok: true };
}
