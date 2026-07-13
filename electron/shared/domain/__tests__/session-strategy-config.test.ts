import { describe, expect, it } from "vitest";
import {
  aiPhaseSectionSchema,
  aiPhaseWorkerSectionSchema,
  aiSectionSchema,
  aiSettingsSectionSchema,
  parseSessionStrategyConfigDoc,
  researchPostureSectionSchema,
  riskSectionSchema,
  selectorSectionSchema,
  sessionStrategyConfigDocSchema,
  sessionStrategyConfigPartialDocSchema,
  strategySectionSchema,
  timeframeSectionSchema,
  tradeRulesSectionSchema,
  SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
} from "../session-strategy-config";
import { defaultSessionStrategyConfigDoc } from "../session-strategy-config-defaults";

describe("sessionStrategyConfigDocSchema", () => {
  it("round-trips every section via defaults", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const parsed = parseSessionStrategyConfigDoc(doc);
    expect(parsed).toEqual(doc);
    expect(parsed.schemaVersion).toBe(SESSION_STRATEGY_CONFIG_SCHEMA_VERSION);
    expect(parsed.strategy).toEqual(strategySectionSchema.parse(doc.strategy));
    expect(parsed.risk).toEqual(riskSectionSchema.parse(doc.risk));
    expect(parsed.timeframe).toEqual(
      timeframeSectionSchema.parse(doc.timeframe),
    );
    expect(parsed.tradeRules).toEqual(
      tradeRulesSectionSchema.parse(doc.tradeRules),
    );
    expect(parsed.researchPosture).toEqual(
      researchPostureSectionSchema.parse(doc.researchPosture),
    );
    expect(parsed.ai.settings).toEqual(
      aiSettingsSectionSchema.parse(doc.ai.settings),
    );
    expect(parsed.ai).toEqual(aiSectionSchema.parse(doc.ai));
    for (const phase of doc.ai.phases) {
      expect(phase).toEqual(aiPhaseSectionSchema.parse(phase));
      for (const worker of phase.workers) {
        expect(worker).toEqual(aiPhaseWorkerSectionSchema.parse(worker));
      }
    }
    expect(parsed.selector).toEqual(selectorSectionSchema.parse(doc.selector));
  });

  it("rejects unknown keys at the document root", () => {
    const doc = {
      ...defaultSessionStrategyConfigDoc(),
      extra: true,
    };
    const result = sessionStrategyConfigDocSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside a section", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const result = strategySectionSchema.safeParse({
      ...doc.strategy,
      mysteryKnob: 1,
    });
    expect(result.success).toBe(false);
  });

  it("gates schemaVersion to literal 1", () => {
    const doc = { ...defaultSessionStrategyConfigDoc(), schemaVersion: 2 };
    const result = sessionStrategyConfigDocSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects missing required sections", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const rest = { ...doc };
    delete (rest as { strategy?: unknown }).strategy;
    const result = sessionStrategyConfigDocSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts a partial preset doc with one section", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const partial = {
      schemaVersion: 1 as const,
      risk: doc.risk,
    };
    expect(sessionStrategyConfigPartialDocSchema.parse(partial)).toEqual(
      partial,
    );
  });

  it("rejects an empty partial preset doc", () => {
    const result = sessionStrategyConfigPartialDocSchema.safeParse({
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
  });

  it("round-trips a phase with workers", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const phase0 = doc.ai.phases[0];
    if (!phase0) throw new Error("expected default phase");
    doc.ai.phases[0] = {
      ...phase0,
      workers: [
        {
          workerId: "scout",
          providerKey: "openrouter",
          modelId: "test-model",
          maxSteps: 8,
          spendLimitUsd: 1.5,
          promptMarkdown: "scout well",
        },
      ],
    };
    const parsed = parseSessionStrategyConfigDoc(doc);
    expect(parsed.ai.phases[0]?.workers).toHaveLength(1);
    expect(parsed.ai.phases[0]?.workers[0]?.workerId).toBe("scout");
  });
});
