import { expect, test } from "@playwright/test";
import { NAV_ITEMS } from "../src/lib/nav";
import {
  cleanupLaunchedExva,
  launchExva,
  navigateToNavItem,
  waitForAppReady,
} from "./helpers/launch-app";

const PAGE_MARKERS: Record<(typeof NAV_ITEMS)[number]["id"], RegExp> = {
  dashboard: /Dashboard/,
  sessions: /Sessions/,
  signals: /Signals & Schedules|Signal/,
  research: /Research|Scorecards|Experience leaderboard/,
  settings: /Settings|Accounts/,
  docs: /Docs|Documentation/,
};

test.describe.serial("navigation", () => {
  test("each main nav item loads its hub without crashing", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      for (const item of NAV_ITEMS) {
        await navigateToNavItem(window, item.label);
        await expect(
          window.getByText(PAGE_MARKERS[item.id]).first(),
        ).toBeVisible({
          timeout: 20_000,
        });
      }
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
