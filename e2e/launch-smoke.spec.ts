import { expect, test } from "@playwright/test";
import { cleanupLaunchedExva, launchExva } from "./helpers/launch-app";

/**
 * Minimal launch-readiness E2E smoke. Verifies the Electron app boots,
 * the main window opens, and the renderer reaches a sane initial state.
 *
 * Run with: bun run package && bunx playwright test
 */
test("app launches and main window appears", async () => {
  const launched = await launchExva();
  try {
    const { window } = launched;
    await window.waitForLoadState("domcontentloaded");
    const title = await window.title();
    expect(title.toLowerCase()).toContain("exva");
  } finally {
    await cleanupLaunchedExva(launched);
  }
});
