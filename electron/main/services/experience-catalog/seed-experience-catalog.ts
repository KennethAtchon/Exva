import type { DbClient } from "../../db/client";
import { ExperienceTemplateRepo } from "./experience-template-repo";
import { InputProfileRepo } from "./input-profile-repo";
import { InstrumentSetRepo } from "../instruments/instrument-set-repo";
import { SourceDefinitionRepo } from "../signals/source-definition-repo";
import { seedExperienceTemplates } from "./experience-template-seeds";
import { seedInstrumentSets } from "../instruments/instrument-set-seeds";
import { seedSourceDefinitions } from "../signals/source-definition-seeds";
import { seedInputProfiles } from "./input-profile-seeds";

/**
 * Seed the full experience catalog in dependency order:
 * 1. Instrument sets  (profiles reference set IDs)
 * 2. Source definitions  (profiles reference source IDs)
 * 3. Experience templates  (profiles reference template IDs)
 * 4. Input profiles
 *
 * All steps are idempotent.
 */
export function seedExperienceCatalog(db: DbClient): void {
  seedInstrumentSets(new InstrumentSetRepo(db));
  seedSourceDefinitions(new SourceDefinitionRepo(db));
  seedExperienceTemplates(new ExperienceTemplateRepo(db));
  seedInputProfiles(new InputProfileRepo(db));
}
