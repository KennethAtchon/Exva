#!/usr/bin/env bun
/**
 * Phase 5 §23 — critical-path smoke runner.
 *
 * Runs the minimum integration/unit subset that proves orchestration,
 * session lifecycle, resilience doctrine, and backtest math work.
 * Full mode also runs E2E launch smoke and the EDGAR backtest CLI.
 *
 * HONESTY: these tests exercise MockAdapter / scratch DBs (and strip
 * ALPACA_* / OPEN_ROUTER_* from the child env). They do not prove live
 * broker adapter HTTP paths — use `bun run prove -- --mode=alpaca|polymarket`
 * for recorded/ghost paper journeys against real venues.
 *
 * Usage:
 *   bun run test:smoke              # critical tests + e2e launch + backtest
 *   bun run test:smoke:critical     # critical tests only
 *   bun run scripts/smoke-critical-path.ts --full-e2e
 *   bun run scripts/smoke-critical-path.ts --skip-backtest
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { ensureHostNativeModules } from "./ensure-host-native-modules";

const ROOT = path.join(import.meta.dir, "..");

const CRITICAL_TESTS = [
  "electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts",
  "electron/main/services/session/__tests__/session-onboarding.integration.test.ts",
  "electron/main/services/orchestration/__tests__/scripted-golden-path.integration.test.ts",
  "electron/main/services/orchestration/cycle/__tests__/runtime-resilience.integration.test.ts",
  "electron/main/services/orchestration/cycle/__tests__/trading-cycle-context.test.ts",
  "electron/main/services/orchestration/policy/__tests__/outcome-classifier.test.ts",
  "electron/main/services/backtest/edgar-drift-backtest.test.ts",
] as const;

type Step = {
  label: string;
  command: string;
  args: string[];
};

type StepResult = Step & {
  ok: boolean;
  durationMs: number;
  exitCode: number | null;
};

function parseArgs(): {
  criticalOnly: boolean;
  fullE2e: boolean;
  skipBacktest: boolean;
} {
  const argv = process.argv.slice(2);
  return {
    criticalOnly: argv.includes("--critical-only"),
    fullE2e: argv.includes("--full-e2e"),
    skipBacktest: argv.includes("--skip-backtest"),
  };
}

/**
 * Bun loads repo `.env` into the parent and re-loads it in child `bun run`
 * processes. Strip credential seed vars and force NODE_ENV=test so `runSeed`
 * never auto-configures AI/broker accounts into vitest DBs.
 */
function testEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, NODE_ENV: "test" };
  delete env.OPEN_ROUTER_KEY;
  delete env.OPEN_ROUTER_MODEL;
  delete env.ALPACA_API_KEY;
  delete env.ALPACA_SECRET_KEY;
  return env;
}

function runStep(step: Step): StepResult {
  const startedAt = Date.now();
  console.log(`\n▶ ${step.label}`);
  console.log(`  ${step.command} ${step.args.join(" ")}`);

  const result: SpawnSyncReturns<string> = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: testEnv(),
  });

  const durationMs = Date.now() - startedAt;
  const ok = result.status === 0;

  if (ok) {
    console.log(`✓ ${step.label} (${formatDuration(durationMs)})`);
  } else {
    const detail =
      result.signal != null
        ? `signal ${result.signal}`
        : `exit ${result.status ?? "unknown"}`;
    console.error(
      `✗ ${step.label} failed (${detail}, ${formatDuration(durationMs)})`,
    );
  }

  return {
    ...step,
    ok,
    durationMs,
    exitCode: result.status,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildSteps(options: ReturnType<typeof parseArgs>): Step[] {
  const steps: Step[] = [
    {
      label: "Critical integration tests",
      command: "bun",
      args: ["run", "test", "--", ...CRITICAL_TESTS],
    },
  ];

  if (options.criticalOnly) {
    return steps;
  }

  // Critical tests rebuild better-sqlite3 for host Node; Electron needs ABI 130.
  steps.push({
    label: "Rebuild better-sqlite3 for Electron",
    command: "bunx",
    args: ["electron-rebuild", "-f", "-w", "better-sqlite3"],
  });

  steps.push(
    options.fullE2e
      ? {
          label: "Full E2E suite",
          command: "bun",
          args: ["run", "test:e2e"],
        }
      : {
          label: "E2E launch smoke",
          command: "bunx",
          args: ["playwright", "test", "e2e/launch-smoke.spec.ts"],
        },
  );

  if (!options.skipBacktest) {
    steps.push({
      label: "EDGAR backtest CLI",
      command: "bun",
      args: ["run", "backtest:edgar"],
    });
  }

  return steps;
}

function printSummary(results: StepResult[]): void {
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log("\n══════════════════════════════════════════");
  console.log("Critical path smoke summary");
  console.log("══════════════════════════════════════════");

  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(
      `  [${mark}] ${result.label} (${formatDuration(result.durationMs)})`,
    );
  }

  console.log("──────────────────────────────────────────");
  console.log(
    `  ${passed.length}/${results.length} steps passed · total ${formatDuration(totalMs)}`,
  );

  if (failed.length > 0) {
    console.error("\nFailed steps:");
    for (const result of failed) {
      console.error(`  - ${result.label}`);
    }
  }
}

function main(): void {
  const options = parseArgs();
  const mode = options.criticalOnly ? "critical-only" : "full";
  console.log(`Exva critical-path smoke (${mode})`);

  ensureHostNativeModules();

  const steps = buildSteps(options);
  const results = steps.map(runStep);
  printSummary(results);

  const allPassed = results.every((r) => r.ok);
  process.exit(allPassed ? 0 : 1);
}

main();
