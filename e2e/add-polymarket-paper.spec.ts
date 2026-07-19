import { expect, test } from "@playwright/test";
import path from "node:path";
import { promises as fs } from "node:fs";
import { cleanupLaunchedExva, launchExva } from "./helpers/launch-app";

test("Add broker Polymarket paper mode shows hover hint, no credentials", async () => {
  const outDir = path.resolve("tmp/ui-snaps-polymarket-paper");
  await fs.mkdir(outDir, { recursive: true });

  const launched = await launchExva();
  try {
    const { window } = launched;
    await window.waitForLoadState("domcontentloaded");
    await expect(
      window.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // Paper badge should already be active on a fresh DB
    await expect(window.getByText(/PAPER/i).first()).toBeVisible();

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      window.getByRole("heading", { name: /Settings|Accounts/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const addBtn = window.getByRole("button", {
      name: /\+?\s*Add broker account/i,
    });
    await addBtn.first().click();

    await expect(
      window.getByRole("heading", { name: "Add broker account" }),
    ).toBeVisible();

    const mockTrigger = window
      .locator('[role="combobox"], button')
      .filter({ hasText: /Mock \(dev/i })
      .first();
    await mockTrigger.click();
    await window
      .getByRole("option", { name: /Polymarket \(prediction markets\)/i })
      .click();

    await expect(
      window.getByText(/Paper \(hover\) mode — no credentials required/i),
    ).toBeVisible();
    await expect(window.getByText(/Polygon private key/i)).toHaveCount(0);

    const file = path.join(outDir, "add-polymarket-paper.png");
    await window.screenshot({ path: file, fullPage: false });
  } finally {
    await cleanupLaunchedExva(launched);
  }
});
