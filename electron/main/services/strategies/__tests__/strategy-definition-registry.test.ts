import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StrategyDefinitionRegistry } from "../strategy-definition-registry";
import { getStrategyDefinitionRegistry } from "../index";
import type { StrategyDefinition } from "../strategy-definition-registry";

describe("StrategyDefinitionRegistry", () => {
  function makeRegistry() {
    return new StrategyDefinitionRegistry();
  }

  function makeDefinition(
    id: string,
    status: "available" | "disabled" = "available",
  ): StrategyDefinition<{ threshold: number }> {
    return {
      id,
      parameterSchemaVersion: 1,
      parameterSchema: z.object({ threshold: z.number().default(1) }),
      acceptedInstrumentClasses: ["stock"] as const,
      supportedTimeframes: ["1h", "4h"] as const,
      minimumCadenceMs: 60_000,
      requiredBarCount: 20,
      implementationStatus: status,
      implementationVersion: 1,
      create: () => ({
        id,
        warmupBars: 20,
        evaluate: () => null,
      }),
    };
  }

  it("registers and retrieves a definition", () => {
    const registry = makeRegistry();
    registry.register(makeDefinition("test-strategy"));
    const def = registry.get("test-strategy");
    expect(def).not.toBeNull();
    expect(def?.id).toBe("test-strategy");
  });

  it("returns null for unknown id", () => {
    const registry = makeRegistry();
    expect(registry.get("nonexistent")).toBeNull();
  });

  it("rejects duplicate registration", () => {
    const registry = makeRegistry();
    registry.register(makeDefinition("dup"));
    expect(() => registry.register(makeDefinition("dup"))).toThrow(
      /already registered/i,
    );
  });

  it("lists all registered definitions", () => {
    const registry = makeRegistry();
    registry.register(makeDefinition("a"));
    registry.register(makeDefinition("b"));
    const ids = registry.list().map((d) => d.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toHaveLength(2);
  });

  describe("require()", () => {
    it("returns an available definition", () => {
      const registry = makeRegistry();
      registry.register(makeDefinition("available-strat"));
      expect(() => registry.require("available-strat")).not.toThrow();
    });

    it("throws for an unknown id", () => {
      const registry = makeRegistry();
      expect(() => registry.require("ghost")).toThrow(/not found/i);
    });

    it("throws for a disabled strategy", () => {
      const registry = makeRegistry();
      registry.register(makeDefinition("off", "disabled"));
      expect(() => registry.require("off")).toThrow(/disabled/i);
    });
  });

  describe("validateParameters()", () => {
    it("succeeds with valid params", () => {
      const registry = makeRegistry();
      registry.register(makeDefinition("v"));
      const result = registry.validateParameters("v", { threshold: 2 });
      expect(result.success).toBe(true);
    });

    it("applies defaults from schema", () => {
      const registry = makeRegistry();
      registry.register(makeDefinition("v"));
      const result = registry.validateParameters("v", {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as { threshold: number }).threshold).toBe(1);
      }
    });

    it("fails with invalid params", () => {
      const registry = makeRegistry();
      registry.register(makeDefinition("v"));
      const result = registry.validateParameters("v", {
        threshold: "not-a-number",
      });
      expect(result.success).toBe(false);
    });

    it("throws for an unknown id", () => {
      const registry = makeRegistry();
      expect(() => registry.validateParameters("unknown", {})).toThrow(
        /not found/i,
      );
    });
  });

  describe("getStrategyDefinitionRegistry() singleton", () => {
    it("has all four built-in strategies", () => {
      const registry = getStrategyDefinitionRegistry();
      const ids = registry.list().map((d) => d.id);
      expect(ids).toContain("mean-reversion");
      expect(ids).toContain("breakout");
      expect(ids).toContain("trend-following");
      expect(ids).toContain("options-flow");
    });

    it("mean-reversion is available and creates a valid strategy", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.require("mean-reversion");
      const strategy = def.create({ zScoreEntry: -2 });
      expect(strategy.id).toBe("mean-reversion");
      expect(strategy.warmupBars).toBeGreaterThan(0);
    });

    it("breakout is available and creates a valid strategy", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.require("breakout");
      const strategy = def.create({
        lookback: 20,
        volumeMultiplierThreshold: 1.5,
      });
      expect(strategy.id).toBe("breakout");
    });

    it("trend-following is available and creates a valid strategy", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.require("trend-following");
      const strategy = def.create({ lookback: 20 });
      expect(strategy.id).toBe("trend-following");
    });

    it("options-flow is available (v2 verticals)", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.require("options-flow");
      expect(def.implementationStatus).toBe("available");
      const strategy = def.create({ useVerticalSpreads: true });
      expect(strategy.id).toBe("options-flow");
    });

    it("unusual-volume is available", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.require("unusual-volume");
      expect(def.implementationStatus).toBe("available");
    });

    it("mean-reversion accepts stock instrument class", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.get("mean-reversion");
      if (!def) throw new Error("expected mean-reversion definition");
      expect(def.acceptedInstrumentClasses).toContain("stock");
    });

    it("breakout accepts crypto instrument class", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.get("breakout");
      if (!def) throw new Error("expected breakout definition");
      expect(def.acceptedInstrumentClasses).toContain("crypto");
    });

    it("trend-following accepts futures instrument class", () => {
      const registry = getStrategyDefinitionRegistry();
      const def = registry.get("trend-following");
      if (!def) throw new Error("expected trend-following definition");
      expect(def.acceptedInstrumentClasses).toContain("futures");
    });

    it("mean-reversion validates and applies default zScoreEntry", () => {
      const registry = getStrategyDefinitionRegistry();
      const result = registry.validateParameters("mean-reversion", {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as { zScoreEntry: number }).zScoreEntry).toBe(-2);
      }
    });

    it("returns the same registry instance on repeated calls", () => {
      expect(getStrategyDefinitionRegistry()).toBe(
        getStrategyDefinitionRegistry(),
      );
    });
  });
});
