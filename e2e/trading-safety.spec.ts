import { expect, test } from "@playwright/test";
import {
  cleanupLaunchedExva,
  launchExva,
  navigateToNavItem,
  waitForAppReady,
} from "./helpers/launch-app";
import { seedMultiSessionWorkspace } from "./helpers/seed-fixtures";

test.describe.serial("trading safety wiring", () => {
  test("multi-session workspace seeds isolated paper sessions through the preload bridge", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      const seeded = await seedMultiSessionWorkspace(window, {
        brokerMaxSessions: 5,
        sessions: Array.from({ length: 5 }, (_, index) => ({
          name: `E2E Allocation ${index + 1}`,
          allocatedUsd: 20_000,
          instrumentScope: ["NVDA", "AAPL", "MSFT", "AMD", "TSLA"][index],
        })),
      });

      expect(seeded.sessions).toHaveLength(5);

      const brokerState = await window.evaluate(async (brokerAccountId) => {
        const exva = window.exva;
        if (!exva) throw new Error("window.exva is not available");
        const brokers = await exva.brokerAccounts.list();
        return brokers.find((broker) => broker.id === brokerAccountId);
      }, seeded.brokerAccountId);

      expect(brokerState).toMatchObject({
        id: seeded.brokerAccountId,
        maxSessions: 5,
        activeSessionCount: 0,
      });

      await navigateToNavItem(window, "Sessions");
      for (const session of seeded.sessions) {
        await expect(
          window
            .getByRole("button", { name: new RegExp(session.sessionName) })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
