import { describe, expect, it } from "vitest";
import { buildWorkerSchedule } from "./worker-graph-scheduler";

const strategyContext = {
  fields: ["identity", "presetBehavior"],
  guidance: ["howToEvaluate"],
} as const;

describe("worker graph scheduler", () => {
  it("builds a flat schedule when no graph mode is requested", () => {
    const schedule = buildWorkerSchedule(
      [
        {
          id: "a",
          promptAssetPath: "a",
          tools: [],
          strategyContext,
          outputMode: "text",
        },
        {
          id: "b",
          promptAssetPath: "b",
          tools: [],
          strategyContext,
          outputMode: "text",
        },
      ],
      undefined,
    );

    expect(schedule.schedulingMode).toBe("flat_parallel");
    expect(schedule.ordered.map((entry) => entry.frontier)).toEqual([0, 0]);
  });

  it("assigns dependent workers to later frontiers", () => {
    const schedule = buildWorkerSchedule(
      [
        {
          id: "a",
          promptAssetPath: "a",
          tools: [],
          strategyContext,
          outputMode: "text",
        },
        {
          id: "b",
          promptAssetPath: "b",
          tools: [],
          strategyContext,
          outputMode: "text",
        },
        {
          id: "c",
          promptAssetPath: "c",
          tools: [],
          strategyContext,
          outputMode: "text",
          dependsOn: ["a", "b"],
        },
      ],
      { mode: "dependency_graph", maxConcurrency: 3 },
    );

    expect(schedule.schedulingMode).toBe("dependency_graph");
    expect(
      schedule.ordered.map((entry) => [entry.worker.id, entry.frontier]),
    ).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
    ]);
  });
});
