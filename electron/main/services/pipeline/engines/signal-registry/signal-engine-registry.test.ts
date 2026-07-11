import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerSignalEngine, requireEngine } from "./signal-engine-registry";
import { registerTradeSignalEngines } from "./register-trade-signal-engines";
import { registerDefaultEngines } from "./register-default-engines";

const engineCtx = {} as never;

describe("signal-engine-registry", () => {
  it("registers and resolves engines by id", () => {
    registerSignalEngine({
      id: "test-fixture-engine",
      kind: "transformer",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.number(),
      run: (input: { value: number }) => input.value * 2,
    });

    expect(
      requireEngine("test-fixture-engine").run({ value: 21 }, engineCtx),
    ).toBe(42);
    expect(() => requireEngine("missing-engine-id-xyz")).toThrow(
      /not registered/,
    );
  });
});

describe("registerTradeSignalEngines", () => {
  it("registers rules engines with deterministic runners", () => {
    registerTradeSignalEngines();

    const engine = requireEngine("rules-mean-reversion");
    const signal = engine.run(
      {
        symbol: "SPY",
        ohlcv: [
          ...Array.from({ length: 19 }, () => ({ close: 100 })),
          { close: 70 },
        ],
        zScoreEntry: -2,
      },
      engineCtx,
    );

    expect((signal as { action: string }).action).toBe("buy");
  });
});

describe("registerDefaultEngines", () => {
  it("wires validator and policy engines to services", () => {
    const validate = vi.fn(() => ({
      allowed: true,
      reasons: [],
      evidence: [],
    }));
    registerDefaultEngines({
      riskEngine: { validateDecision: vi.fn() } as never,
      candidateValidation: { validate } as never,
      orderPolicyGate: { evaluate: vi.fn(() => ({ allowed: true })) } as never,
      brokerAllocationGate: {
        checkOrderFits: vi.fn(() => ({ ok: true })),
        checkInstrumentConflict: vi.fn(() => ({ ok: true })),
      } as never,
      exitPolicyEvaluator: { evaluate: vi.fn() } as never,
    });

    const validator = requireEngine("candidate-validator");
    validator.run({ sessionId: "s1" } as never, engineCtx);

    expect(validate).toHaveBeenCalled();
    expect(requireEngine("risk-summary").kind).toBe("context");
    expect(requireEngine("order-policy").kind).toBe("policy");
  });
});
