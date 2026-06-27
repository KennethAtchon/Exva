import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import { loadExperiencePresetBundle } from "../session-bootstrap";
import {
  listExperiences,
  registerExperience,
  validateExperienceRegistry,
} from "../index";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { registerPipeline } from "../../services/pipeline/implementations/registry/pipeline-router";
import { ALL_PIPELINES } from "../../services/pipeline/implementations/registry/pipelines";

beforeAll(() => {
  for (const p of ALL_PIPELINES) {
    try {
      registerPipeline(p);
    } catch {
      /* already registered */
    }
  }
});

describe("loadExperiencePresetBundle", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it.each(listExperiences().map((experience) => [experience.id]))(
    "loads seeded presets for %s",
    (experienceId) => {
      const bundle = loadExperiencePresetBundle(db, experienceId);

      expect(bundle.posturePreset.id).toBeTruthy();
      expect(bundle.rulesPreset.id).toBeTruthy();
      expect(bundle.riskPreset.id).toBeTruthy();
      expect(bundle.timeframePreset.id).toBeTruthy();
    },
  );

  it("applies edgar-catalyst defaults expected by session creation", () => {
    const bundle = loadExperiencePresetBundle(db, "edgar-catalyst");

    expect(bundle.posturePreset.id).toBe("edgar_catalyst");
    expect(bundle.rulesPreset.id).toBe("catalyst_entry");
    expect(bundle.riskPreset.id).toBe("moderate");
    expect(bundle.timeframePreset.id).toBe("catalyst");
  });

  it("throws when an experience references a missing preset", () => {
    expect(() => loadExperiencePresetBundle(db, "missing-experience")).toThrow(
      /not registered/i,
    );
  });
});

describe("experience registry", () => {
  it("validates all shipped experiences", () => {
    expect(() => validateExperienceRegistry()).not.toThrow();
    expect(listExperiences()).toHaveLength(6);
  });

  it("rejects duplicate experience registration", () => {
    expect(() => registerExperience(EDGAR_CATALYST_EXPERIENCE)).toThrow(
      /already registered/i,
    );
  });

  it("lists all five shipped experience ids", () => {
    expect(
      listExperiences()
        .map((experience) => experience.id)
        .sort(),
    ).toEqual(
      [
        "edgar-catalyst",
        "options-flow-edge",
        "prediction-event-edge",
        "rules-breakout",
        "rules-mean-reversion",
        "rules-trend-following",
      ].sort(),
    );
  });
});
