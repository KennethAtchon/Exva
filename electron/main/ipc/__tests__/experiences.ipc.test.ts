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

  it("experiences:list returns all 5 experiences with contract fields", async () => {
    const experiences = (await invokeIpc(channels.experiences.list)) as Array<{
      id: string;
      pipelineId: string;
      capabilities: {
        signalSourceTypes: string[];
      };
    }>;

    expect(experiences).toHaveLength(5);
    expect(experiences.map((item) => item.id).sort()).toEqual(
      [
        "edgar-catalyst",
        "prediction-event-edge",
        "rules-breakout",
        "rules-mean-reversion",
        "rules-trend-following",
      ].sort(),
    );

    for (const experience of experiences) {
      expect(experience.id).toEqual(expect.any(String));
      expect(experience.pipelineId).toEqual(expect.any(String));
      expect(experience.capabilities.signalSourceTypes.length).toBeGreaterThan(
        0,
      );
    }
  });
});
