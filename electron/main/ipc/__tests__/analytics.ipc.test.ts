import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { listExperiences } from "../../experiences";
import { createMinimalSession, insertTrade } from "../../db/test-fixtures";
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

    expect(result.scorecards).toHaveLength(listExperiences().length);
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
});
