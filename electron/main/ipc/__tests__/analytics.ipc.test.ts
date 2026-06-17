import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("analytics IPC", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
    registerIpcTestHandlers(ctx.services);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("experiences:listScorecards returns scorecards for all experiences", async () => {
    const result = (await invokeIpc(channels.experiences.listScorecards)) as {
      scorecards: Array<{ experienceId: string; displayName: string }>;
    };

    expect(result.scorecards).toHaveLength(5);
    expect(result.scorecards.map((item) => item.experienceId)).toContain(
      "edgar-catalyst",
    );
  });

  it("experiences:getScorecard returns scorecard for one experienceId", async () => {
    const session = createMinimalSession(ctx.db, {
      experienceId: "edgar-catalyst",
    });
    insertTrade(ctx.db, {
      id: "trade-1",
      sessionId: session.id,
      status: "closed",
      final_pnl_usd: 25,
    });

    const result = (await invokeIpc(channels.experiences.getScorecard, {
      experienceId: "edgar-catalyst",
    })) as {
      scorecard: {
        experienceId: string;
        tradeCount: number;
        netPnlUsd: number;
      };
    };

    expect(result.scorecard.experienceId).toBe("edgar-catalyst");
    expect(result.scorecard.tradeCount).toBe(1);
    expect(result.scorecard.netPnlUsd).toBe(25);
  });

  it("experiences:recordExperiment inserts and experiences:listExperiments lists rows", async () => {
    await invokeIpc(channels.experiences.recordExperiment, {
      id: "exp-1",
      experienceId: "edgar-catalyst",
      configHash: "abc123",
      metrics: { winRate: 0.55, expectancy: 12 },
      notes: "baseline",
      verdict: "promising",
    });

    const listed = (await invokeIpc(channels.experiences.listExperiments, {
      experienceId: "edgar-catalyst",
    })) as {
      experiments: Array<{ id: string; verdict: string; configHash: string }>;
    };

    expect(listed.experiments).toHaveLength(1);
    expect(listed.experiments[0]).toMatchObject({
      id: "exp-1",
      verdict: "promising",
      configHash: "abc123",
    });
  });

  it("experiences:compareExperiments returns metric diffs between two experiments", async () => {
    await invokeIpc(channels.experiences.recordExperiment, {
      id: "exp-a",
      experienceId: "rules-mean-reversion",
      configHash: "hash-a",
      metrics: { winRate: 0.5, expectancy: 10 },
      notes: "",
      verdict: "inconclusive",
    });
    await invokeIpc(channels.experiences.recordExperiment, {
      id: "exp-b",
      experienceId: "rules-mean-reversion",
      configHash: "hash-b",
      metrics: { winRate: 0.6, expectancy: 15 },
      notes: "",
      verdict: "promising",
    });

    const result = (await invokeIpc(channels.experiences.compareExperiments, {
      experimentIdA: "exp-a",
      experimentIdB: "exp-b",
    })) as {
      comparison: {
        a: { id: string };
        b: { id: string };
        metricDiffs: Record<
          string,
          { a: unknown; b: unknown; delta: number | null }
        >;
      } | null;
    };

    expect(result.comparison).not.toBeNull();
    expect(result.comparison?.a.id).toBe("exp-a");
    expect(result.comparison?.b.id).toBe("exp-b");
    expect(result.comparison?.metricDiffs.expectancy).toEqual({
      a: 10,
      b: 15,
      delta: 5,
    });
  });

  it("experiences:getResearchSummary returns summary deltas", async () => {
    const session = createMinimalSession(ctx.db, {
      experienceId: "edgar-catalyst",
    });
    insertTrade(ctx.db, {
      id: "trade-win",
      sessionId: session.id,
      status: "closed",
      final_pnl_usd: 40,
    });
    insertAgentRun(ctx.db, {
      id: "run-1",
      session_id: session.id,
      cost_usd: 0.25,
    });

    const result = (await invokeIpc(
      channels.experiences.getResearchSummary,
    )) as {
      summary: {
        generatedAt: string;
        deltas: Array<{ experienceId: string; verdict: string }>;
      };
    };

    expect(result.summary.generatedAt).toEqual(expect.any(String));
    expect(result.summary.deltas.length).toBe(5);
    expect(
      result.summary.deltas.find(
        (item) => item.experienceId === "edgar-catalyst",
      ),
    ).toMatchObject({
      experienceId: "edgar-catalyst",
      verdict: expect.stringMatching(/improved|unchanged|degraded/),
    });
  });
});
