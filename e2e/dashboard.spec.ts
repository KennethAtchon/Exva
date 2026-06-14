import { expect, test } from "@playwright/test";
import {
  cleanupLaunchedExva,
  launchExva,
  navLocator,
  waitForAppReady,
} from "./helpers/launch-app";

test.describe.serial("dashboard", () => {
  test("loads dashboard with fresh empty-state metrics", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      await expect(window.getByText("exva", { exact: true })).toBeVisible();
      await expect(
        window.getByRole("heading", { name: "Dashboard", level: 1 }),
      ).toBeVisible();
      await expect(
        navLocator(window).getByRole("button", {
          name: "Dashboard",
          exact: true,
        }),
      ).toBeVisible();

      await expect(window.getByText("Global workspace metrics")).toBeVisible();
      await expect(window.getByText("Portfolio Value")).toBeVisible();
      await expect(window.getByText("Open Positions")).toBeVisible();
      await expect(window.getByText("0 total today")).toBeVisible();
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
