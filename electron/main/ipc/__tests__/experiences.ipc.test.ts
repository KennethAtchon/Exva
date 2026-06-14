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

  it("experiences:list returns all 6 experiences with contract fields", async () => {
    const experiences = (await invokeIpc(channels.experiences.list)) as Array<{
      id: string;
      pipelineId: string;
      signalSourceType: string;
      capabilities: {
        instrumentClasses: string[];
        signalSourceTypes: string[];
      };
    }>;

    expect(experiences).toHaveLength(6);
    expect(experiences.map((item) => item.id).sort()).toEqual(
      [
        "btc-momentum-breakout",
        "commodities-trend-following",
        "edgar-catalyst",
        "prediction-event-edge",
        "rules-mean-reversion",
        "rules-qqq-mean-reversion",
      ].sort(),
    );

    for (const experience of experiences) {
      expect(experience.id).toEqual(expect.any(String));
      expect(experience.pipelineId).toEqual(expect.any(String));
      expect(experience.signalSourceType).toEqual(expect.any(String));
      expect(experience.capabilities.instrumentClasses.length).toBeGreaterThan(
        0,
      );
      expect(experience.capabilities.signalSourceTypes).toContain(
        experience.signalSourceType,
      );
    }
  });
});
