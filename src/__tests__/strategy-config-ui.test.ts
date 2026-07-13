import { describe, expect, it } from "vitest";
import {
  buildStrategyConfigPatch,
  diffConfigDocs,
  isStaleVersionError,
  mapDocToUiSections,
  staleVersionUserMessage,
} from "@/lib/strategy-config-ui";
import { defaultSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config-defaults";

describe("strategy-config-ui helpers", () => {
  it("detects STALE_VERSION by code or message", () => {
    expect(isStaleVersionError({ code: "STALE_VERSION", message: "x" })).toBe(
      true,
    );
    expect(
      isStaleVersionError(
        new Error(
          "Strategy config version mismatch for session s1: expected 2, found 3",
        ),
      ),
    ).toBe(true);
    expect(isStaleVersionError(new Error("VALIDATION_FAILED"))).toBe(false);
    expect(staleVersionUserMessage()).toContain("version conflict");
  });

  it("maps a config doc into UI sections with session meta", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const mapped = mapDocToUiSections(
      "sess-1",
      doc,
      "2026-07-13T00:00:00.000Z",
    );
    expect(mapped.researchPosture.sessionId).toBe("sess-1");
    expect(mapped.rules.rulesPresetId).toBe(doc.tradeRules.rulesPresetId);
    expect(mapped.riskConfig.maxPositionUsd).toBe(doc.risk.maxPositionUsd);
    expect(mapped.aiPhases.length).toBeGreaterThan(0);
    expect(mapped.aiPhases[0]?.workerOverrides).toEqual([]);
  });

  it("builds a section patch only for dirty fields", () => {
    const doc = defaultSessionStrategyConfigDoc();
    const mapped = mapDocToUiSections("sess-1", doc, "now");
    const patch = buildStrategyConfigPatch({
      dirtyFields: new Set(["riskConfig.maxPositionUsd", "rules.setupType"]),
      researchPosture: mapped.researchPosture,
      rules: { ...mapped.rules, setupType: "event_entry" },
      riskConfig: { ...mapped.riskConfig, maxPositionUsd: 999 },
      timeframe: mapped.timeframe,
      aiSettings: mapped.aiSettings,
      aiPhases: mapped.aiPhases,
    });
    expect(patch.risk).toMatchObject({ maxPositionUsd: 999 });
    expect(patch.tradeRules).toMatchObject({ setupType: "event_entry" });
    expect(patch.researchPosture).toBeUndefined();
    expect(patch.ai).toBeUndefined();
  });

  it("diffs config docs by section for history drawer", () => {
    const before = defaultSessionStrategyConfigDoc();
    const after = {
      ...before,
      risk: { ...before.risk, maxPositionUsd: 1234 },
    };
    const diffs = diffConfigDocs(before, after);
    const risk = diffs.find((entry) => entry.section === "risk");
    const style = diffs.find((entry) => entry.section === "researchPosture");
    expect(risk?.changed).toBe(true);
    expect(style?.changed).toBe(false);
    expect(risk?.after).toContain("1234");
  });
});
