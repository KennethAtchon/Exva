import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import { ExperienceTemplateRepo } from "../experience-template-repo";
import { InstrumentSetRepo } from "../../instruments/instrument-set-repo";
import { SourceDefinitionRepo } from "../../signals/source-definition-repo";
import { InputProfileRepo } from "../input-profile-repo";
import { seedExperienceCatalog } from "../seed-experience-catalog";
import { TEMPLATE_IDS } from "../experience-template-seeds";
import { INSTRUMENT_SET_IDS } from "../../instruments/instrument-set-seeds";
import { SOURCE_DEFINITION_IDS } from "../../signals/source-definition-seeds";
import { INPUT_PROFILE_IDS } from "../input-profile-seeds";

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

describe("seedExperienceCatalog", () => {
  let db: DbClient;
  let templateRepo: ExperienceTemplateRepo;
  let setRepo: InstrumentSetRepo;
  let sourceRepo: SourceDefinitionRepo;
  let profileRepo: InputProfileRepo;

  beforeEach(() => {
    db = createTestDb();
    templateRepo = new ExperienceTemplateRepo(db);
    setRepo = new InstrumentSetRepo(db);
    sourceRepo = new SourceDefinitionRepo(db);
    profileRepo = new InputProfileRepo(db);
    seedExperienceCatalog(db);
  });

  it("seeds all 6 experience templates as active", () => {
    const ids = Object.values(TEMPLATE_IDS);
    for (const id of ids) {
      const rev = requireValue(
        templateRepo.getActiveRevision(id),
        `template ${id} should be active`,
      );
      expect(rev.status).toBe("active");
    }
  });

  it("idempotent: second seed does not create duplicate revisions", () => {
    seedExperienceCatalog(db);
    for (const id of Object.values(TEMPLATE_IDS)) {
      const revisions = templateRepo.listRevisions(id);
      expect(revisions).toHaveLength(1);
    }
  });

  it("mean-reversion template has correct inputContract", () => {
    const rev = requireValue(
      templateRepo.getActiveRevision(TEMPLATE_IDS.MEAN_REVERSION),
      "mean-reversion template should be active",
    );
    expect(rev.inputContract.modes).toContain("scheduled_scan");
    expect(rev.inputContract.instrumentClasses).toContain("stock");
    expect(rev.strategyId).toBe("mean-reversion");
    expect(rev.universePolicy).toBe("allow_unvalidated_with_warning");
  });

  it("edgar template has correct inputContract", () => {
    const rev = requireValue(
      templateRepo.getActiveRevision(TEMPLATE_IDS.EDGAR_CATALYST),
      "edgar template should be active",
    );
    expect(rev.inputContract.modes).toContain("event_source");
    expect(rev.inputContract.sourceKinds).toContain("edgar_8k");
    expect(rev.inputContract.signalKinds).toContain("filing");
    expect(rev.universePolicy).toBe("validated_only");
    expect(rev.strategyId).toBeNull();
  });

  it("prediction template has correct inputContract", () => {
    const rev = requireValue(
      templateRepo.getActiveRevision(TEMPLATE_IDS.PREDICTION_EVENT),
      "prediction template should be active",
    );
    expect(rev.inputContract.modes).toContain("event_source");
    expect(rev.inputContract.sourceKinds).toContain("prediction_event");
    expect(rev.universePolicy).toBe("validated_only");
    expect(rev.brokerRequirement).toBe("polymarket_broker");
  });

  it("options-flow template is seeded as active despite disabled strategy", () => {
    const rev = requireValue(
      templateRepo.getActiveRevision(TEMPLATE_IDS.OPTIONS_FLOW),
      "options-flow template should be active",
    );
    expect(rev.status).toBe("active");
    expect(rev.strategyId).toBe("options-flow");
  });

  it("list() returns summaries for all 6 templates", () => {
    const summaries = templateRepo.list();
    const ids = summaries.map((s) => s.templateId);
    for (const id of Object.values(TEMPLATE_IDS)) {
      expect(ids).toContain(id);
    }
  });

  it("seeds all 4 instrument sets with correct members", () => {
    const etfs = requireValue(
      setRepo.getActiveRevision(INSTRUMENT_SET_IDS.LIQUID_US_ETFS),
      "liquid US ETFs set should be active",
    );
    expect(etfs.members.map((m) => m.canonicalId)).toEqual(
      expect.arrayContaining(["SPY", "QQQ"]),
    );

    const crypto = requireValue(
      setRepo.getActiveRevision(INSTRUMENT_SET_IDS.MAJOR_CRYPTO),
      "major crypto set should be active",
    );
    expect(crypto.members.map((m) => m.canonicalId)).toContain("BTC-USD");
    expect(crypto.instrumentClass).toBe("crypto");

    const futures = requireValue(
      setRepo.getActiveRevision(INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH),
      "commodities set should be active",
    );
    expect(futures.instrumentClass).toBe("futures");
    expect(futures.members.map((m) => m.canonicalId)).toEqual(
      expect.arrayContaining(["GC", "CL"]),
    );

    const flow = requireValue(
      setRepo.getActiveRevision(INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS),
      "options-flow stocks set should be active",
    );
    expect(flow.members.map((m) => m.canonicalId)).toEqual(
      expect.arrayContaining(["AAPL", "NVDA"]),
    );
  });

  it("seeds source definitions", () => {
    const edgar = requireValue(
      sourceRepo.get(SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST),
      "edgar source should exist",
    );
    expect(edgar.kind).toBe("edgar_8k");
    expect(edgar.outputContractId).toBe("signal/filing");

    const pred = requireValue(
      sourceRepo.get(SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE),
      "prediction source should exist",
    );
    expect(pred.kind).toBe("prediction_event");

    const mock = requireValue(
      sourceRepo.get(SOURCE_DEFINITION_IDS.MOCK_REHEARSAL),
      "mock source should exist",
    );
    expect(mock.kind).toBe("mock");
  });

  it("seeds input profiles for all 6 experiences", () => {
    for (const profileId of Object.values(INPUT_PROFILE_IDS)) {
      const profile = profileRepo.get(profileId);
      expect(profile, `profile ${profileId} should exist`).not.toBeNull();
    }
  });

  it("mean-reversion profile references correct set and cadence", () => {
    const profile = requireValue(
      profileRepo.get(INPUT_PROFILE_IDS.MEAN_REVERSION_DEFAULT),
      "mean-reversion profile should exist",
    );
    expect(profile.mode).toBe("scheduled_scan");
    if (profile.mode === "scheduled_scan") {
      expect(profile.instrumentSetId).toBe(INSTRUMENT_SET_IDS.LIQUID_US_ETFS);
      expect(profile.analysisTimeframe).toBe("1h");
      expect(profile.marketCalendarId).toBe("nyse-regular");
      expect(profile.cadence.kind).toBe("interval");
      if (profile.cadence.kind === "interval") {
        expect(profile.cadence.every).toBe(15);
        expect(profile.cadence.unit).toBe("minute");
      }
    }
  });

  it("edgar profile references the edgar source definition", () => {
    const profile = requireValue(
      profileRepo.get(INPUT_PROFILE_IDS.EDGAR_DEFAULT),
      "edgar profile should exist",
    );
    expect(profile.mode).toBe("event_source");
    if (profile.mode === "event_source") {
      expect(profile.sourceDefinitionId).toBe(
        SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
      );
      expect(profile.analysisTimeframe).toBe("1d");
    }
  });

  it("can reproduce experience summaries without reading descriptor files", () => {
    const summaries = templateRepo.list();
    const meanRev = requireValue(
      summaries.find((s) => s.templateId === TEMPLATE_IDS.MEAN_REVERSION),
      "mean-reversion summary should exist",
    );
    expect(meanRev.displayName).toBe("Rules: Mean Reversion");
    expect(meanRev.inputModes).toContain("scheduled_scan");
    expect(meanRev.instrumentClasses).toContain("stock");
    expect(meanRev.activeVersion).toBe(1);
  });
});
