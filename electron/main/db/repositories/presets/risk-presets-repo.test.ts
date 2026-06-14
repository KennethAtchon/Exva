import { describe, expect, it } from "vitest";
import { builtInRiskPresets } from "@electron/shared/presets";
import { createTestDb } from "../../test-helpers";
import { RiskPresetsRepo } from "./risk-presets-repo";

describe("RiskPresetsRepo", () => {
  it("lists and finds seeded risk presets", () => {
    const db = createTestDb();
    const repo = new RiskPresetsRepo(db);
    const builtIn = builtInRiskPresets()[0];

    expect(repo.list().some((preset) => preset.id === builtIn.id)).toBe(true);
    expect(repo.findById(builtIn.id)).toMatchObject({ id: builtIn.id });
    expect(repo.findById("missing")).toBeUndefined();

    db.sqlite.close();
  });
});
