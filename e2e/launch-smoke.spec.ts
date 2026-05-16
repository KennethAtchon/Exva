import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

/**
 * Minimal launch-readiness E2E smoke. Verifies the Electron app boots,
 * the main window opens, and the renderer reaches a sane initial state.
 *
 * The full Phase 8 launch-critical E2E suite (paper-session start,
 * approval-required trade, force-close, restart/rehydration,
 * live-readiness modal/ack invalidation, renderer/preload contract)
 * builds on this scaffold but requires:
 *   - A built app (`bun run package`) so .vite/build/main.cjs exists
 *   - Per-test userData isolation (handled below)
 *   - Pre-seeded fixtures for provider/broker accounts to avoid keychain
 *
 * Run with: bun run package && bunx playwright test
 */
test("app launches and main window appears", async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "exva-e2e-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    env: { ...process.env, EXVA_DB_REBUILD_FROM_SCRATCH: "true" },
  });

  try {
    const window = await app.firstWindow({ timeout: 30_000 });
    await window.waitForLoadState("domcontentloaded");
    const title = await window.title();
    expect(title.toLowerCase()).toContain("exva");
  } finally {
    await app.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
