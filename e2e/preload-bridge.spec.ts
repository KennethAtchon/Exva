import { expect, test } from "@playwright/test";
import {
  cleanupLaunchedExva,
  launchExva,
  waitForAppReady,
} from "./helpers/launch-app";

const EXPECTED_EXVA_KEYS = [
  "dashboard",
  "session",
  "trades",
  "approvals",
  "experiences",
  "strategy",
  "workspace",
  "events",
  "autopsy",
  "signals",
  "brokerAccounts",
  "templates",
  "config",
  "accounts",
  "developer",
] as const;

const EXPECTED_DASHBOARD_STAT_KEYS = [
  "session_status",
  "daily_pnl_usd",
  "daily_pnl_pct",
  "total_trades_today",
  "closed_trades_today",
  "win_rate_today",
  "open_trades",
  "daily_api_spend",
  "api_budget",
  "portfolio_value",
  "portfolio_value_source",
  "portfolio_broker_count",
  "unrealized_pnl",
  "consecutive_losers",
  "session_uptime_min",
] as const;

test.describe.serial("preload bridge", () => {
  test("window.exva exposes IPC namespaces and dashboard.getStats works", async () => {
    const launched = await launchExva();
    try {
      const { window } = launched;
      await waitForAppReady(window);

      const bridge = await window.evaluate(async () => {
        const exva = (window as Window & { exva?: Record<string, unknown> })
          .exva;
        if (!exva || typeof exva !== "object") {
          return { exists: false as const };
        }

        const keys = Object.keys(exva).sort();
        const dashboard = exva.dashboard as
          | { getStats?: () => Promise<Record<string, unknown>> }
          | undefined;
        const stats =
          typeof dashboard?.getStats === "function"
            ? await dashboard.getStats()
            : null;

        return {
          exists: true as const,
          keys,
          stats,
        };
      });

      expect(bridge.exists).toBe(true);
      for (const key of EXPECTED_EXVA_KEYS) {
        expect(bridge.keys).toContain(key);
      }

      expect(bridge.stats).not.toBeNull();
      for (const key of EXPECTED_DASHBOARD_STAT_KEYS) {
        expect(bridge.stats).toHaveProperty(key);
      }
      expect(bridge.stats?.session_status).toBe("idle");
      expect(bridge.stats?.open_trades).toBe(0);
    } finally {
      await cleanupLaunchedExva(launched);
    }
  });
});
