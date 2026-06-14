import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { channels } from "../channels";

function flattenChannelValues(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (obj && typeof obj === "object") {
    return Object.values(obj).flatMap(flattenChannelValues);
  }
  return [];
}

function flattenChannelPaths(obj: unknown, prefix = "channels"): string[] {
  if (typeof obj === "string") return [prefix];
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([key, value]) =>
      flattenChannelPaths(value, `${prefix}.${key}`),
    );
  }
  return [];
}

const repoRoot = path.resolve(__dirname, "../../../..");
const registerSrc = readFileSync(
  path.join(repoRoot, "electron/main/ipc/register.ts"),
  "utf8",
);
const preloadSrc = readFileSync(
  path.join(repoRoot, "electron/preload/index.ts"),
  "utf8",
);

const EXPECTED_HANDLER_REGISTRARS = [
  "registerExperienceHandlers",
  "registerAnalyticsHandlers",
  "registerDashboardHandlers",
  "registerTradeHandlers",
  "registerAutopsyHandlers",
  "registerPeriodAutopsyHandlers",
  "registerApprovalHandlers",
  "registerSessionHandlers",
  "registerStrategyHandlers",
  "registerWorkspaceHandlers",
  "registerTemplateHandlers",
  "registerConfigHandlers",
  "registerAccountHandlers",
  "registerBrokerAccountHandlers",
  "registerEventHandlers",
  "registerReplayHandlers",
  "registerSignalHandlers",
  "registerDeveloperHandlers",
] as const;

describe("ipc channel contract", () => {
  it("flattens all invoke channel strings from channels.ts", () => {
    const values = flattenChannelValues(channels);
    expect(values.length).toBeGreaterThan(100);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("dashboard:get-stats");
    expect(values).toContain("session:start");
  });

  it("register.ts imports and invokes every handler group", () => {
    for (const registrar of EXPECTED_HANDLER_REGISTRARS) {
      expect(registerSrc).toContain(registrar);
    }
    expect(registerSrc).toMatch(
      /export function registerIpcHandlers[\s\S]*registerDeveloperHandlers\(services\);/,
    );
  });

  it("preload/index.ts references core renderer channel paths", () => {
    const corePaths = [
      "channels.dashboard.getStats",
      "channels.dashboard.getCostBreakdown",
      "channels.session.start",
      "channels.trades.listActive",
      "channels.approvals.list",
      "channels.events.list",
    ];
    for (const ref of corePaths) {
      expect(preloadSrc).toContain(ref);
    }
  });

  it("reports orphan channel paths not wired through preload", () => {
    const paths = flattenChannelPaths(channels);
    const orphans = paths.filter((ref) => !preloadSrc.includes(ref));
    expect(orphans).toContain("channels.session.buildCycleFixture");
    expect(orphans).toContain("channels.experiences.listExperiments");
    expect(orphans).toContain("channels.workspace.viewGet");
    expect(orphans.length).toBeGreaterThan(0);
  });
});
