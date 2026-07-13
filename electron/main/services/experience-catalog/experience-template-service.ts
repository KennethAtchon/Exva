import type { DbClient } from "../../db/client";
import type {
  ExperienceTemplateRevision,
  ExperienceTemplateSummary,
} from "@electron/shared/domain/experience-inputs/catalog";
import { ExperienceTemplateRepo } from "./experience-template-repo";
import { seedExperienceTemplates } from "./experience-template-seeds";

export class ExperienceTemplateService {
  constructor(private readonly repo: ExperienceTemplateRepo) {}

  listTemplates(): ExperienceTemplateSummary[] {
    return this.repo.list();
  }

  getActiveRevision(templateId: string): ExperienceTemplateRevision | null {
    return this.repo.getActiveRevision(templateId);
  }

  getRevision(
    templateId: string,
    version: number,
  ): ExperienceTemplateRevision | null {
    return this.repo.getRevision(templateId, version);
  }

  /**
   * Require the active revision or throw a descriptive error.
   */
  requireActiveRevision(templateId: string): ExperienceTemplateRevision {
    const rev = this.repo.getActiveRevision(templateId);
    if (!rev) {
      throw new Error(
        `ExperienceTemplateService: no active revision for template "${templateId}"`,
      );
    }
    return rev;
  }

  /**
   * Seed all built-in experience templates. Idempotent.
   */
  seedCatalog(): void {
    seedExperienceTemplates(this.repo);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExperienceTemplateService(db: DbClient): ExperienceTemplateService {
  return new ExperienceTemplateService(new ExperienceTemplateRepo(db));
}
