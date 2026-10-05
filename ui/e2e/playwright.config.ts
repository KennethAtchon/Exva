import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// The UI is tested against a real engine in demo mode: Simulator broker, synthetic market, 60× clock.
const home = mkdtempSync(join(tmpdir(), "exva-e2e-"));
const port = 7499;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1400, height: 900 },
    launchOptions: process.env.EXVA_CHROMIUM ? { executablePath: process.env.EXVA_CHROMIUM } : {},
  },
  webServer: {
    command: `bun ../../engine/src/cli.ts run --demo --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    env: { EXVA_HOME: home, EXVA_TOKEN: "e2e-token" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
