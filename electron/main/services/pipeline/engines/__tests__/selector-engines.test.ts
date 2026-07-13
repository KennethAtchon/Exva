import { buildSearchEverythingScope } from "@electron/shared/instruments/session-instrument-classes";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../../engines";
import { resolveEngine, type InputEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";
import type { PhaseWorkerResult } from "../registry";
import type { AIPhaseContext } from "../../phases/types";

const outputSchema = z.object({ score: z.number() });

function baseCtx(overrides: Partial<AIPhaseContext> = {}): AIPhaseContext {
  return {
    phase: "selector",
    pipelineId: "default-trade-cycle",
    sessionId: "s1",
    cycleId: "c1",
    tradeId: null,
    session: {
      id: "s1",
      instrumentScope: buildSearchEverythingScope("stock"),
      selectionMode: "ai_picker",
    } as never,
    instrumentClasses: ["stock"],
    strategyContext: {
      timeframe: { holdingStyle: "multi_day_swing" },
    } as never,
    toolContext: {} as never,
    services: {
      sessionBrokerAssignmentsRepo: {
        listBrokerAccountIds: () => ["broker-1"],
      },
      brokerAccountsRepo: {
        find: (id: string) =>
          id === "broker-1"
            ? {
                id,
                name: "Mock Paper",
                supportedInstrumentClasses: ["stock"],
              }
            : null,
      },
      instrumentCacheRepo: {
        get: () => null,
        clear: () => undefined,
        save: () => undefined,
      },
      strategyContextService: {
        getSelectorSettings: () => ({
          aiPickerEnabled: true,
          noInstrumentRetryMinutes: null,
        }),
        get: () => ({ timeframe: { holdingStyle: "multi_day_swing" } }),
      },
    } as never,
    runner: {} as never,
    input: {},
    ...overrides,
  };
}

describe("selector engines", () => {
  it("selector-scope emits full-universe discovery instructions", async () => {
    const engine = resolveEngine<InputEngine>("selector-scope", "input");
    const text = await engine.build(baseCtx());
    expect(text).toMatch(/full-universe discovery/i);
    expect(text).toMatch(/stock/);
  });

  it("selector-scope returns the configured scope for non-search-everything sessions", async () => {
    const engine = resolveEngine<InputEngine>("selector-scope", "input");
    const text = await engine.build(
      baseCtx({
        session: {
          id: "s1",
          instrumentScope: "Large-cap tech only",
          selectionMode: "manual_shortlist",
        } as never,
      }),
    );
    expect(text).toBe("Large-cap tech only");
  });

  it("broker-coverage lists assigned broker capabilities", async () => {
    const engine = resolveEngine<InputEngine>("broker-coverage", "input");
    const text = await engine.build(baseCtx());
    expect(text).toMatch(/Broker coverage constraints/);
    expect(text).toMatch(/Mock Paper/);
    expect(text).toMatch(/stock: tradable via/);
  });

  it("broker-coverage warns when no brokers are assigned", async () => {
    const engine = resolveEngine<InputEngine>("broker-coverage", "input");
    const text = await engine.build(
      baseCtx({
        services: {
          sessionBrokerAssignmentsRepo: { listBrokerAccountIds: () => [] },
          brokerAccountsRepo: { find: () => null },
        } as never,
      }),
    );
    expect(text).toMatch(/No broker accounts are assigned/);
  });
});

describe("pickWorkerOutput", () => {
  it("returns output from the worker whose schema matches by reference", () => {
    const worker = {
      id: "w1",
      prompt: "p",
      tools: [],
      strategyContext: { fields: [], guidance: [] },
      outputMode: "tool_result",
      outputSchema,
    } as PhaseWorkerResult["worker"];
    const results: PhaseWorkerResult[] = [
      {
        worker,
        result: {
          output: { score: 0.75 },
          run: {} as never,
          message: {} as never,
        },
      },
    ];

    expect(pickWorkerOutput<{ score: number }>(results, outputSchema)).toEqual({
      score: 0.75,
    });
    expect(
      pickWorkerOutput(results, z.object({ other: z.string() })),
    ).toBeNull();
  });
});
