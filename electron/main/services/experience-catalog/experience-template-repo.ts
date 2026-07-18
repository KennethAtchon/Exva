import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  experienceTemplates,
  experienceTemplateRevisions,
} from "../../db/schema";
import type {
  ExperienceTemplateRevision,
  ExperienceTemplateSummary,
  TemplateStatus,
} from "@electron/shared/domain/experience-inputs/catalog";
import type {
  UniversePolicy,
  TemplateInputContract,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { ExperiencePresetIds } from "@electron/shared/domain/signal-descriptor";
import type { ExperienceResearchContract } from "@electron/shared/domain/research-contract";
import type { ProcessingMode } from "@electron/shared/domain/enums";
import type { BrokerRequirement } from "@electron/shared/domain/experience";
import { requireJsonParse } from "../infra/safe-json-parse";

export class ExperienceTemplateRepo {
  constructor(private readonly db: DbClient) {}

  /** Ensure the template header row exists; idempotent. */
  ensureTemplate(id: string): void {
    const now = new Date().toISOString();
    this.db.db
      .insert(experienceTemplates)
      .values({ id, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }

  get(templateId: string): ExperienceTemplateRevision | null {
    const rev = this.getActiveRevision(templateId);
    return rev;
  }

  getRevision(
    templateId: string,
    version: number,
  ): ExperienceTemplateRevision | null {
    const row = this.db.db
      .select()
      .from(experienceTemplateRevisions)
      .where(
        and(
          eq(experienceTemplateRevisions.templateId, templateId),
          eq(experienceTemplateRevisions.version, version),
        ),
      )
      .get();
    return row ? rowToRevision(row) : null;
  }

  getActiveRevision(templateId: string): ExperienceTemplateRevision | null {
    const row = this.db.db
      .select()
      .from(experienceTemplateRevisions)
      .where(
        and(
          eq(experienceTemplateRevisions.templateId, templateId),
          eq(experienceTemplateRevisions.status, "active"),
        ),
      )
      .get();
    return row ? rowToRevision(row) : null;
  }

  listRevisions(templateId: string): ExperienceTemplateRevision[] {
    return this.db.db
      .select()
      .from(experienceTemplateRevisions)
      .where(eq(experienceTemplateRevisions.templateId, templateId))
      .all()
      .map(rowToRevision);
  }

  /**
   * Insert a new revision. Active revisions cannot be mutated — always call
   * createRevision to add a new version. Returns the inserted revision.
   */
  createRevision(input: {
    templateId: string;
    version: number;
    status: TemplateStatus;
    displayName: string;
    description: string;
    pipelineId: string;
    strategyId: string | null;
    promptVariantKey: ProcessingMode;
    brokerRequirement: BrokerRequirement;
    inputContract: TemplateInputContract;
    defaultPresetIds: ExperiencePresetIds;
    researchContract: ExperienceResearchContract;
    universePolicy: UniversePolicy;
  }): ExperienceTemplateRevision {
    const now = new Date().toISOString();
    this.db.db
      .insert(experienceTemplateRevisions)
      .values({
        templateId: input.templateId,
        version: input.version,
        status: input.status,
        displayName: input.displayName,
        description: input.description,
        pipelineId: input.pipelineId,
        strategyId: input.strategyId,
        promptVariantKey: input.promptVariantKey,
        brokerRequirement: input.brokerRequirement,
        inputContractJson: JSON.stringify(input.inputContract),
        defaultPresetIdsJson: JSON.stringify(input.defaultPresetIds),
        researchContractJson: JSON.stringify(input.researchContract),
        universePolicy: input.universePolicy,
        createdAt: now,
      })
      .run();

    const saved = this.getRevision(input.templateId, input.version);
    if (!saved) {
      throw new Error(
        `ExperienceTemplateRepo: revision (${input.templateId}, v${input.version}) not found after insert`,
      );
    }
    return saved;
  }

  /** Idempotent upsert-or-skip for seeding. */
  createRevisionIfAbsent(
    input: Parameters<typeof this.createRevision>[0],
  ): ExperienceTemplateRevision {
    const existing = this.getRevision(input.templateId, input.version);
    if (existing) return existing;
    this.ensureTemplate(input.templateId);
    return this.createRevision(input);
  }

  list(): ExperienceTemplateSummary[] {
    const templates = this.db.db.select().from(experienceTemplates).all();
    return templates.map((t) => this.buildSummary(t.id));
  }

  private buildSummary(templateId: string): ExperienceTemplateSummary {
    const revisions = this.listRevisions(templateId);
    const active = revisions.find((r) => r.status === "active");
    const latest = revisions.reduce<ExperienceTemplateRevision | null>(
      (max, r) => (!max || r.version > max.version ? r : max),
      null,
    );

    const displayRev = active ?? latest;
    return {
      templateId,
      latestVersion: latest?.version ?? 0,
      activeVersion: active?.version ?? null,
      displayName: displayRev?.displayName ?? "",
      description: displayRev?.description ?? "",
      inputModes: displayRev?.inputContract.modes ?? [],
      instrumentClasses: displayRev?.inputContract.instrumentClasses ?? [],
      status: displayRev?.status ?? "draft",
    };
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToRevision(
  row: typeof experienceTemplateRevisions.$inferSelect,
): ExperienceTemplateRevision {
  return {
    templateId: row.templateId,
    version: row.version,
    status: row.status as TemplateStatus,
    displayName: row.displayName,
    description: row.description,
    pipelineId: row.pipelineId,
    strategyId: row.strategyId,
    promptVariantKey: row.promptVariantKey as ProcessingMode,
    brokerRequirement: row.brokerRequirement as BrokerRequirement,
    inputContract: requireJsonParse<TemplateInputContract>(
      row.inputContractJson,
      undefined,
      "Invalid experience template inputContractJson",
    ),
    defaultPresetIds: requireJsonParse<ExperiencePresetIds>(
      row.defaultPresetIdsJson,
      undefined,
      "Invalid experience template defaultPresetIdsJson",
    ),
    researchContract: requireJsonParse<ExperienceResearchContract>(
      row.researchContractJson,
      undefined,
      "Invalid experience template researchContractJson",
    ),
    universePolicy: row.universePolicy as UniversePolicy,
  };
}
