import { describe, expect, it } from "vitest";
import { EventBus } from "../../infra/event-bus";
import { PipelineWorkerProgressTracker } from "../pipeline-worker-progress-tracker";

describe("PipelineWorkerProgressTracker", () => {
  it("stores latest worker progress and clears on phase complete", () => {
    const bus = new EventBus();
    const tracker = new PipelineWorkerProgressTracker(bus);
    tracker.start();

    bus.emit("pipeline_worker_progress", {
      sessionId: "s1",
      cycleId: "c1",
      phase: "selector",
      stageId: "workers",
      frontier: 0,
      tradeId: null,
      workers: [
        { workerId: "web-scout", status: "running" },
        { workerId: "market-validator", status: "running" },
      ],
    });

    expect(tracker.get("s1")?.workers).toHaveLength(2);
    expect(tracker.get("s1")?.phase).toBe("selector");

    bus.emit("research_phase_complete", {
      sessionId: "s1",
      phase: "selector",
      cycleId: "c1",
      instrumentCount: 0,
    });
    expect(tracker.get("s1")).toBeNull();

    tracker.stop();
  });
});
