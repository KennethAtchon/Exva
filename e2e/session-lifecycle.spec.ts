import { expect, test } from "@playwright/test";
import {
  cleanupLaunchedExva,
  launchExva,
  navigateToNavItem,
  waitForAppReady,
} from "./helpers/launch-app";
import {
  getFocusedSessionStatus,
  seedPaperTradingSession,
} from "./helpers/seed-fixtures";

test.describe.serial("session lifecycle (paper)", () => {
  test("seeded session appears on Sessions page", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      const seeded = await seedPaperTradingSession(window, {
        sessionName: "E2E EDGAR Paper",
      });

      await navigateToNavItem(window, "Sessions");
      await expect(
        window
          .getByRole("button", { name: new RegExp(seeded.sessionName) })
          .first(),
      ).toBeVisible({
        timeout: 15_000,
      });

      const status = await getFocusedSessionStatus(window);
      expect(status).toBe("draft");
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });

  test("start → pause → resume transitions session status", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      await seedPaperTradingSession(window, {
        sessionName: "E2E Lifecycle",
      });

      await window.evaluate(async () => {
        const exva = window.exva;
        if (!exva) throw new Error("window.exva is not available");
        await exva.session.start();
      });

      await expect
        .poll(async () => getFocusedSessionStatus(window), {
          timeout: 20_000,
        })
        .toMatch(/active|paused/);

      await window.evaluate(async () => {
        const exva = window.exva;
        if (!exva) throw new Error("window.exva is not available");
        await exva.session.pause();
      });

      await expect
        .poll(async () => getFocusedSessionStatus(window), {
          timeout: 10_000,
        })
        .toBe("paused");

      await window.evaluate(async () => {
        const exva = window.exva;
        if (!exva) throw new Error("window.exva is not available");
        await exva.session.resume();
      });

      await expect
        .poll(async () => getFocusedSessionStatus(window), {
          timeout: 15_000,
        })
        .toBe("active");

      await window.evaluate(async () => {
        const exva = window.exva;
        if (!exva) throw new Error("window.exva is not available");
        await exva.session.stop();
      });

      await expect
        .poll(async () => getFocusedSessionStatus(window), {
          timeout: 15_000,
        })
        .toMatch(/stopped|idle|draft/);
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
