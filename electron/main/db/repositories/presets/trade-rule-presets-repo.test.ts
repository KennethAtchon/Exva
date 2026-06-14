import { describe, expect, it } from "vitest";
import { builtInTradeRulePresets } from "@electron/shared/presets";
import { createTestDb } from "../../test-helpers";
import { TradeRulePresetsRepo } from "./trade-rule-presets-repo";

describe("TradeRulePresetsRepo", () => {
  it("lists and finds seeded trade rule presets", () => {
    const db = createTestDb();
    const repo = new TradeRulePresetsRepo(db);
    const builtIn = builtInTradeRulePresets()[0];

    expect(repo.list().some((preset) => preset.id === builtIn.id)).toBe(true);
    expect(repo.findById(builtIn.id)).toMatchObject({ id: builtIn.id });

    db.sqlite.close();
  });
});
