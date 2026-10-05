import { expect, test } from "@playwright/test";

test("home shows bots that are actually trading, and the status bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Heartbeat", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo engine")).toBeVisible();
  // The demo clock runs 60× fast: within seconds the heartbeat bot has bought and sold.
  await expect(page.getByText(/[1-9]\d* trades today/).first()).toBeVisible({ timeout: 30_000 });
});

test("bot page answers why it did or didn't trade, with a chart", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Crypto Trend", { exact: true }).click();
  await expect(page.getByText(/Why no trades today\?|Today/).first()).toBeVisible();
  await expect(page.getByText("Checks", { exact: true })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByText(/EMA9 .* vs EMA21/).first()).toBeVisible({ timeout: 20_000 });
});

test("the wizard previews a strategy before creating the bot", async ({ page }) => {
  await page.goto("/bots/new");
  await page.getByText("Donchian Breakout").click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Last 30 days with these settings")).toBeVisible();
  await expect(page.getByText(/per day/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Create (stopped)" }).click();
  await expect(page.getByRole("heading", { name: /Donchian Breakout/ })).toBeVisible();
  await expect(page.getByText("This bot is stopped.")).toBeVisible();
});

test("a Lab backtest shows money, trades and an equity curve", async ({ page }) => {
  await page.goto("/lab");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.getByText("Net P&L").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Equity and drawdown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create bot from this run" })).toBeVisible();
});

test("the kill switch stops all trading and can be resumed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "■ Stop all" }).click();
  await page.getByRole("button", { name: "Stop all trading" }).click();
  await expect(page.getByRole("button", { name: /TRADING STOPPED/ })).toBeVisible();
  await page.getByRole("button", { name: /TRADING STOPPED/ }).click();
  await expect(page.getByRole("button", { name: "■ Stop all" })).toBeVisible();
});

test("settings default to DeepSeek V4.1 Flash on OpenRouter", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator('input[value="deepseek/deepseek-v4.1-flash"]')).toBeVisible();
  await expect(page.locator('input[value="https://openrouter.ai/api/v1"]')).toBeVisible();
});
