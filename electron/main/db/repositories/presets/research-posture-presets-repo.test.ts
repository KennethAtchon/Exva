import { describe, expect, it } from "vitest";
import { builtInResearchPosturePresets } from "@electron/shared/presets";
import { createTestDb } from "../../test-helpers";
import { ResearchPosturePresetsRepo } from "./research-posture-presets-repo";

describe("ResearchPosturePresetsRepo", () => {
  it("lists and finds seeded research posture presets", () => {
    const db = createTestDb();
    const repo = new ResearchPosturePresetsRepo(db);
    const builtIn = builtInResearchPosturePresets()[0];

    expect(repo.list().some((preset) => preset.id === builtIn.id)).toBe(true);
    expect(repo.findById(builtIn.id)).toMatchObject({ id: builtIn.id });

    db.sqlite.close();
  });
});
