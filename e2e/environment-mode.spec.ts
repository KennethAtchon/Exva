import { expect, test } from "@playwright/test";
import {
  cleanupLaunchedExva,
  launchExva,
  waitForAppReady,
} from "./helpers/launch-app";

test.describe.serial("environment mode", () => {
  test("fresh install shows Paper mode chip", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      const paperPill = window.locator(
        '[title="Paper trading mode — no real orders"]',
      );
      await expect(paperPill).toBeVisible();
      await expect(paperPill).toContainText("Paper");
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
