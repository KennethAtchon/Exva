import { buildSearchEverythingScope } from "@electron/shared/instruments/session-instrument-classes";
import type { InstrumentClass } from "@/lib/types";
import { describe, expect, it } from "vitest";
import "../../engines";
import {
  hashSelectorDefinition,
  SELECTOR_INSTRUMENT_CACHE_ENGINE,
} from "../cache/selector-instrument-cache";
import type { AIPhaseContext } from "../../phases/types";

function cacheCtx(overrides: {
  cached?: {
    instruments: string;
    definitionHash: string;
    expiresAt: string;
  } | null;
}): AIPhaseContext & {
  services: AIPhaseContext["services"] & {
    instrumentCacheRepo: {
      get: () => unknown;
      clear: (sessionId: string) => void;
      save: (row: unknown) => void;
    };
    _cleared: string[];
    _saved: unknown[];
  };
} {
  const saved: unknown[] = [];
  const cleared: string[] = [];
  return {
    phase: "selector",
    pipelineId: "default-trade-cycle",
    sessionId: "s1",
    cycleId: "c1",
    tradeId: null,
    session: {
      id: "s1",
      selectionMode: "ai_selected_universe",
      instrumentScope: buildSearchEverythingScope("stock"),
      defaultSearchProviderId: null,
    } as never,
    instrumentClasses: ["stock"],
    strategyContext: {} as never,
    toolContext: {} as never,
    services: {
      strategyContextService: {
        getSelectorSettings: () => ({ aiPickerEnabled: true }),
        getAiPhase: () => null,
        get: () => ({ timeframe: { holdingStyle: "multi_day_swing" } }),
      },
      workspacePreferencesRepo: {
        get: () => ({ defaultSearchProviderId: null }),
      },
      brokerRouting: {
        resolveBrokerAccountId: () => "broker-1",
      },
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
        get: () => overrides.cached ?? null,
        clear: (sessionId: string) => {
          cleared.push(sessionId);
        },
        save: (row: unknown) => {
          saved.push(row);
        },
      },
      _cleared: cleared,
      _saved: saved,
    } as never,
    runner: {} as never,
    input: {},
  };
}

describe("selector-instrument-cache", () => {
  it("hashes selector definition fingerprints deterministically", () => {
    const fp = {
      selectionMode: "ai_selected_universe" as const,
      aiPickerEnabled: true,
      instrumentScope: buildSearchEverythingScope("stock"),
      instrumentClasses: ["stock"] as InstrumentClass[],
      searchProviderId: null,
      selectorRole: {
        providerKey: "",
        modelId: "",
        promptSource: "default" as const,
        promptMarkdown: "",
      },
      routingSnapshot: [
        { instrumentClass: "stock" as const, brokerAccountId: "b1" },
      ],
    };

    expect(hashSelectorDefinition(fp)).toBe(hashSelectorDefinition(fp));
  });

  it("returns null when cache fingerprint does not match", () => {
    const ctx = cacheCtx({
      cached: {
        instruments: JSON.stringify([{ symbol: "AAPL" }]),
        definitionHash: "stale-hash",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const fingerprint = SELECTOR_INSTRUMENT_CACHE_ENGINE.fingerprint(ctx);

    expect(SELECTOR_INSTRUMENT_CACHE_ENGINE.read(ctx, fingerprint)).toBeNull();
  });

  it("clears expired cache entries on read", () => {
    const ctx = cacheCtx({
      cached: {
        instruments: JSON.stringify([{ symbol: "AAPL" }]),
        definitionHash: "any",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(SELECTOR_INSTRUMENT_CACHE_ENGINE.read(ctx, "any")).toBeNull();
    expect(ctx.services._cleared).toEqual(["s1"]);
  });

  it("writes non-empty instrument selections to cache", () => {
    const ctx = cacheCtx({});
    const fingerprint = SELECTOR_INSTRUMENT_CACHE_ENGINE.fingerprint(ctx);
    const output = {
      instruments: [{ symbol: "NVDA", instrumentClass: "stock" as const }],
    };

    expect(SELECTOR_INSTRUMENT_CACHE_ENGINE.shouldWrite?.(output)).toBe(true);
    SELECTOR_INSTRUMENT_CACHE_ENGINE.write(ctx, fingerprint, output as never, {
      agentRunId: "run-1",
      cycleId: "c1",
    });

    expect(ctx.services._saved).toHaveLength(1);
    expect(ctx.services._saved[0]).toMatchObject({
      sessionId: "s1",
      definitionHash: fingerprint,
      cycleId: "c1",
      selectorAgentRunId: "run-1",
    });
  });
});
