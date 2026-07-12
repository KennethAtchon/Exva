import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import {
  createIpcTestServices,
  invokeIpc,
  registerIpcTestHandlers,
  type IpcTestContext,
} from "./ipc-test-harness";

describe("experiences IPC", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
    registerIpcTestHandlers(ctx.services);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("experiences:list returns all experiences with contract fields", async () => {
    const experiences = (await invokeIpc(channels.experiences.list)) as Array<{
      id: string;
      pipelineId: string;
      capabilities: {
        signalSourceTypes: string[];
      };
      schedules?: Array<{ id: string; symbol: string }>;
    }>;

    expect(experiences).toHaveLength(6);
    expect(experiences.map((item) => item.id).sort()).toEqual(
      [
        "edgar-catalyst",
        "options-flow-edge",
        "prediction-event-edge",
        "rules-breakout",
        "rules-mean-reversion",
        "rules-trend-following",
      ].sort(),
    );

    for (const experience of experiences) {
      expect(experience.id).toEqual(expect.any(String));
      expect(experience.pipelineId).toEqual(expect.any(String));
      const hasSignals = experience.capabilities.signalSourceTypes.length > 0;
      const hasSchedules = (experience.schedules?.length ?? 0) > 0;
      expect(hasSignals || hasSchedules).toBe(true);
    }

    const meanRev = experiences.find((e) => e.id === "rules-mean-reversion");
    expect(meanRev?.capabilities.signalSourceTypes).toEqual([]);
    expect(meanRev?.schedules?.map((s) => s.id)).toEqual([
      "spy-15m-meanrev",
      "qqq-15m-meanrev",
    ]);
  });
});
