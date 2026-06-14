import { beforeAll, describe, expect, it } from "vitest";
import { ensurePipelineBootRegistered } from "../../__tests__/pipeline-test-boot";
import { listPipelineDefinitions } from "../pipeline-registry";

describe("pipeline-registry", () => {
  beforeAll(() => {
    ensurePipelineBootRegistered();
  });

  it("lists every registered phase definition", () => {
    const phases = listPipelineDefinitions().map((entry) => entry.phase);
    expect(phases).toContain("selector");
    expect(phases).toContain("technical");
    expect(phases).toContain("fundamental");
    expect(phases).toContain("review");
    expect(phases).toContain("decision");
  });

  it("includes workers for each phase in the catalog", () => {
    for (const { phase, definition } of listPipelineDefinitions()) {
      expect(definition.workers.length, `${phase} workers`).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate worker ids in a phase definition", () => {
    const selector = listPipelineDefinitions().find(
      (entry) => entry.phase === "selector",
    );
    expect(selector).toBeDefined();
    if (!selector) throw new Error("expected selector phase");
    const workers = selector.definition.workers;
    const ids = workers.map((worker) => worker.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
