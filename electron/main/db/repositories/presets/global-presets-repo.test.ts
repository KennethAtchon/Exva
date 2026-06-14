import { describe, expect, it } from "vitest";
import { builtInGlobalStrategyPresets } from "@electron/shared/presets";
import { createTestDb } from "../../test-helpers";
import { GlobalPresetsRepo } from "./global-presets-repo";

describe("GlobalPresetsRepo", () => {
  it("lists seeded presets and supports user CRUD", () => {
    const db = createTestDb();
    const repo = new GlobalPresetsRepo(db);
    const builtIn = builtInGlobalStrategyPresets()[0];

    expect(repo.list().some((row) => row.id === builtIn.id)).toBe(true);

    const created = repo.insert({
      name: "Custom Global",
      preset: {
        description: "Custom strategy",
        summaryBullets: ["Custom"],
        posturePresetId: builtIn.posturePresetId,
        rulesPresetId: builtIn.rulesPresetId,
        riskPresetId: builtIn.riskPresetId,
        timeframePresetId: builtIn.timeframePresetId,
      },
    });
    expect(created.isBuiltIn).toBe(false);

    repo.update(created.id, {
      name: "Renamed Custom",
      preset: {
        description: "Updated",
        summaryBullets: ["Updated"],
        posturePresetId: builtIn.posturePresetId,
        rulesPresetId: builtIn.rulesPresetId,
        riskPresetId: builtIn.riskPresetId,
        timeframePresetId: builtIn.timeframePresetId,
      },
    });
    expect(repo.list().find((row) => row.id === created.id)?.name).toBe(
      "Renamed Custom",
    );

    repo.delete(created.id);
    expect(repo.list().find((row) => row.id === created.id)).toBeUndefined();

    db.sqlite.close();
  });
});
