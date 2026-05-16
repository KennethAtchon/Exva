import { defineConfig } from "@playwright/test";

/**
 * Electron E2E configuration.
 *
 * Tests live under `e2e/` and drive the real packaged Electron app via
 * Playwright's `_electron` API. Each test is launched in its own Electron
 * process to keep them isolated from each other.
 *
 * Prerequisites:
 *   - The app must be built first: `bun run package`
 *   - Tests assume a clean SQLite DB; the harness deletes the userData
 *     directory before each test.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // Electron processes are heavy; run serially.
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
