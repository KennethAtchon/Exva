import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { runAnalysisStep } from "../stage-runner";

describe("stage-runner", () => {
  it("skips engine-chain stages when skipIf returns true", async () => {
    const next = await runAnalysisStep(
      {
        id: "candidate_validation",
        kind: "engine-chain",
        required: false,
        engines: [
          {
            engineId: "candidate-validator",
            engineKind: "validator",
            inputBuilderId: "candidate-validation",
            bindingPhase: "technical",
          },
        ],
        skipIf: () => true,
      },
      { runAIPhase: async () => ({}) } as never,
      { decision: undefined } as never,
    );

    expect(next).toEqual({ decision: undefined });
  });

  it("requires non-decision phase outputs to include a symbol", async () => {
    await expect(
      runAnalysisStep(
        {
          id: "technical",
          kind: "phase",
          phase: "technical",
          required: true,
          buildInput: () => ({}),
          applyOutput: (state, result) => ({
            ...state,
            technical: result as never,
          }),
        },
        {
          runAIPhase: async () => ({
            output: { action: "skip" },
            run: { cost_usd: 0 } as never,
            message: {} as never,
          }),
        } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("allows decision phase outputs without a symbol field", async () => {
    const next = await runAnalysisStep(
      {
        id: "decision",
        kind: "phase",
        phase: "decision",
        required: true,
        buildInput: () => ({}),
        applyOutput: (state, result) => ({
          ...state,
          decision: result as never,
        }),
      },
      {
        runAIPhase: async () => ({
          output: { action: "skip", reasoning: "no edge" },
          run: { cost_usd: 0 } as never,
          message: {} as never,
        }),
      } as never,
      {} as never,
    );

    expect(next.decision?.output).toEqual({
      action: "skip",
      reasoning: "no edge",
    });
  });
});
