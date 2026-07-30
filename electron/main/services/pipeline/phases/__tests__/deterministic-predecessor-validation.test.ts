import { beforeAll, describe, expect, it } from "vitest";
import { ensurePipelineBootRegistered } from "../../__tests__/pipeline-test-boot";
import { assertAIPhaseDeterministicPredecessors } from "../deterministic-predecessor-validation";

describe("assertAIPhaseDeterministicPredecessors", () => {
  beforeAll(() => {
    ensurePipelineBootRegistered();
  });

  it("passes for registered selector verification predecessors", () => {
    expect(() => assertAIPhaseDeterministicPredecessors()).not.toThrow();
  });
});
