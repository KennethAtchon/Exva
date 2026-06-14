import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StrategySnapshot } from "@/lib/types";
import { channels } from "@electron/shared/ipc/channels";
import {
  createMinimalSession,
  insertAgentRun,
  insertTrade,
} from "../../db/test-fixtures";
import {
  createIpcTestServices,
  invokeIpc,
  registerIpcTestHandlers,
  type IpcTestContext,
} from "./ipc-test-harness";

function makeStrategySnapshot(): StrategySnapshot {
  return {
    version: 5,
    researchPosture: {
      posturePresetId: "edgar_catalyst",
      processingMode: "manual",
      evidenceMode: "balanced",
      catalystMode: "preferred",
      fundamentalStrictness: "balanced",
      postureNotes: "",
    },
    rules: {
      rulesPresetId: "catalyst_entry",
      setupType: "catalyst_entry",
      sideBias: "long_only",
      entryStyle: "catalyst",
      exitStyle: "fixed_pct",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "",
    },
    riskConfig: {
      maxPositionUsd: 1000,
      stopLossPct: 5,
      takeProfitPct: 10,
      stopLossType: "fixed_pct",
      atrStopMultiplier: null,
      kellyFraction: 0,
      predictionEdgeThreshold: 0.55,
      maxExposureUsd: null,
      waitForOpenThreshold: 0,
      maxConcurrentTrades: 3,
      maxConsecutiveLosers: 5,
      volatilityHaltMaxSpreadPct: null,
      dailyLossLimitUsd: 500,
      profitTargetUsd: 2000,
      maxAiSpendUsd: 10,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
    },
    timeframe: {
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: null,
      maxHoldDays: 1,
      timeframeNotes: "",
    },
  };
}

function seedCycleFixture(
  ctx: IpcTestContext,
  cycleId: string,
): { sessionId: string; tradeId: string } {
  const session = createMinimalSession(ctx.db, {
    experienceId: "edgar-catalyst",
  });
  const trade = insertTrade(ctx.db, {
    id: `trade-${cycleId}`,
    sessionId: session.id,
    status: "closed",
    final_pnl_usd: 30,
  });
  const run = insertAgentRun(ctx.db, {
    id: `run-${cycleId}`,
    session_id: session.id,
    trade_id: trade.id,
    cycle_id: cycleId,
  });

  ctx.services.repos.agentMessages.insert({
    id: `msg-${cycleId}`,
    agent_run_id: run.id,
    session_id: session.id,
    trade_id: trade.id,
    cycle_id: cycleId,
    role: "assistant",
    provider_key: "provider-openrouter",
    model_id: "openai/gpt-4o-mini",
    messages_json: "[]",
    thinking_json: null,
    tool_calls_json: null,
    output_json: JSON.stringify({ action: "no_trade", confidence: 0.4 }),
    output_schema_name: "decision",
    parse_fallback: false,
    strategy_snapshot_json: JSON.stringify(makeStrategySnapshot()),
    market_snapshot_json: null,
    created_at: run.created_at,
  });

  return { sessionId: session.id, tradeId: trade.id };
}

describe("replay IPC", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
    registerIpcTestHandlers(ctx.services);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("session:buildCycleFixture returns fixture built from cycle messages", async () => {
    const cycleId = "cycle-build-1";
    const seeded = seedCycleFixture(ctx, cycleId);

    const result = (await invokeIpc(channels.session.buildCycleFixture, {
      sessionId: seeded.sessionId,
      cycleId,
    })) as {
      fixture: {
        sessionId: string;
        cycleId: string;
        strategySnapshot: StrategySnapshot;
      } | null;
    };

    expect(result.fixture).not.toBeNull();
    expect(result.fixture?.sessionId).toBe(seeded.sessionId);
    expect(result.fixture?.cycleId).toBe(cycleId);
    expect(result.fixture?.strategySnapshot.version).toBe(5);
  });

  it("session:saveCycleFixture writes fixture JSON under replay dir", async () => {
    const cycleId = "cycle-save-1";
    const seeded = seedCycleFixture(ctx, cycleId);

    const result = (await invokeIpc(channels.session.saveCycleFixture, {
      sessionId: seeded.sessionId,
      cycleId,
    })) as { filePath: string | null };

    expect(result.filePath).toEqual(expect.any(String));
    const filePath = result.filePath;
    expect(filePath).toBeTruthy();
    if (!filePath) return;

    expect(fs.existsSync(filePath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      cycleId: string;
      sessionId: string;
    };
    expect(saved.cycleId).toBe(cycleId);
    expect(saved.sessionId).toBe(seeded.sessionId);
  });

  it("session:getPaperScorecard returns scorecard from session trade history", async () => {
    const session = createMinimalSession(ctx.db, {
      experienceId: "edgar-catalyst",
    });
    insertTrade(ctx.db, {
      id: "trade-win",
      sessionId: session.id,
      status: "closed",
      final_pnl_usd: 50,
    });
    insertTrade(ctx.db, {
      id: "trade-loss",
      sessionId: session.id,
      status: "closed",
      final_pnl_usd: -20,
    });

    const result = (await invokeIpc(channels.session.getPaperScorecard, {
      sessionId: session.id,
    })) as {
      scorecard: {
        tradeCount: number;
        winCount: number;
        lossCount: number;
        netPnlUsd: number;
      };
    };

    expect(result.scorecard.tradeCount).toBe(2);
    expect(result.scorecard.winCount).toBe(1);
    expect(result.scorecard.lossCount).toBe(1);
    expect(result.scorecard.netPnlUsd).toBe(30);
  });
});
