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
      acceptsScanHit: boolean;
    }>;

    expect(experiences.map((item) => item.id).sort()).toEqual(
      [
        "edgar-catalyst",
        "options-flow-edge",
        "paper-execution-canary",
        "prediction-event-edge",
        "rules-breakout",
        "rules-mean-reversion",
        "rules-trend-following",
      ].sort(),
    );

    for (const experience of experiences) {
      expect(experience.id).toEqual(expect.any(String));
      expect(experience.pipelineId).toEqual(expect.any(String));
      expect(experience.supportState).toEqual(
        expect.stringMatching(/^(available|forward_paper_only|blocked)$/),
      );
      const hasSignalSources =
        experience.capabilities.signalSourceTypes.length > 0;
      expect(hasSignalSources || experience.acceptsScanHit).toBe(true);
    }

    const trend = experiences.find((e) => e.id === "rules-trend-following");
    expect(trend?.supportState).toBe("blocked");

    const meanRev = experiences.find((e) => e.id === "rules-mean-reversion");
    expect(meanRev?.capabilities.signalSourceTypes).toEqual([]);
    expect(meanRev?.acceptsScanHit).toBe(true);

    const edgar = experiences.find((e) => e.id === "edgar-catalyst");
    expect(edgar?.capabilities.signalSourceTypes).toEqual(["edgar_8k"]);
    expect(edgar?.acceptsScanHit).toBe(false);
  });
});
