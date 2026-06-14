import { describe, expect, it } from "vitest";
import type { AIPhaseContext } from "../../../phases/types";
import { resolveEngine } from "../../registry";
import "../../index";

function buildCtx(
  overrides: {
    session?: Partial<AIPhaseContext["session"]>;
    input?: Record<string, unknown>;
    aiPickerEnabled?: boolean;
  } = {},
): AIPhaseContext {
  return {
    phase: "selector",
    pipelineId: "default",
    sessionId: "session-1",
    cycleId: "cycle-1",
    tradeId: null,
    instrumentClasses: ["stock"],
    session: {
      id: "session-1",
      selectionMode: "signal_driven",
      instrumentScope: "",
      instrumentClasses: ["stock"],
      ...(overrides.session ?? {}),
    } as AIPhaseContext["session"],
    strategyContext: {
      riskConfig: { maxConcurrentTrades: 3 },
    } as AIPhaseContext["strategyContext"],
    toolContext: {} as AIPhaseContext["toolContext"],
    services: {
      sessionSelectorSettingsRepo: {
        get: () => ({
          aiPickerEnabled: overrides.aiPickerEnabled ?? false,
        }),
      },
    } as never,
    runner: {} as AIPhaseContext["runner"],
    input: overrides.input ?? {},
  };
}

describe("manual-shortlist entry engine", () => {
  const engine = () =>
    resolveEngine<import("../../registry").EntryModeEngine>(
      "manual-shortlist",
      "entry_mode",
    );

  it("does not match signal-driven sessions without a web-search trigger", async () => {
    const ctx = buildCtx({
      session: {
        selectionMode: "signal_driven",
        instrumentScope: "",
      },
      aiPickerEnabled: false,
    });

    expect(engine().matches(ctx)).toBe(false);
  });

  it("matches manual shortlist sessions with configured tickers", () => {
    const ctx = buildCtx({
      session: {
        selectionMode: "manual_shortlist",
        instrumentScope: "NVDA",
      },
      aiPickerEnabled: false,
    });

    expect(engine().matches(ctx)).toBe(true);
    expect(engine().resolve(ctx)).toEqual({
      instruments: [
        expect.objectContaining({
          symbol: "NVDA",
          instrumentClass: "stock",
        }),
      ],
    });
  });

  it("throws when manual shortlist is empty after parsing", () => {
    const ctx = buildCtx({
      session: {
        selectionMode: "manual_shortlist",
        instrumentScope: "",
      },
      aiPickerEnabled: false,
    });

    expect(engine().matches(ctx)).toBe(true);
    expect(() => engine().resolve(ctx)).toThrow(
      "Manual instrument shortlist is empty after parsing.",
    );
  });
});
