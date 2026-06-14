import { describe, expect, it } from "vitest";
import { builtInTimeframePresets } from "@electron/shared/presets";
import { createTestDb } from "../../test-helpers";
import { TimeframePresetsRepo } from "./timeframe-presets-repo";

describe("TimeframePresetsRepo", () => {
  it("lists and finds seeded timeframe presets", () => {
    const db = createTestDb();
    const repo = new TimeframePresetsRepo(db);
    const builtIn = builtInTimeframePresets()[0];

    expect(repo.list().some((preset) => preset.id === builtIn.id)).toBe(true);
    expect(repo.findById(builtIn.id)).toMatchObject({ id: builtIn.id });

    db.sqlite.close();
  });
});
