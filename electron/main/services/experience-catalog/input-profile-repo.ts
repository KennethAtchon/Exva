import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { experienceInputProfiles } from "../../db/schema";
import type {
  ExperienceInputProfile,
  InputMode,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { CadenceSpec } from "@electron/shared/domain/experience-inputs/cadence";

// ---------------------------------------------------------------------------
// Discriminated create inputs
// ---------------------------------------------------------------------------

export type InputProfileCreateInput =
  | {
      id: string;
      templateId: string;
      templateVersion: number;
      mode: "event_source";
      name: string;
      sourceDefinitionId: string;
      sourceRevision: number;
      filters: Record<string, unknown>;
      analysisTimeframe: TradingTimeframe;
    }
  | {
      id: string;
      templateId: string;
      templateVersion: number;
      mode: "scheduled_scan";
      name: string;
      instrumentSetId: string;
      instrumentSetRevision: number;
      cadence: CadenceSpec;
      analysisTimeframe: TradingTimeframe;
      marketCalendarId: string;
      strategyParameters: Record<string, unknown>;
    };

export class InputProfileRepo {
  constructor(private readonly db: DbClient) {}

  get(id: string): ExperienceInputProfile | null {
    const row = this.db.db
      .select()
      .from(experienceInputProfiles)
      .where(eq(experienceInputProfiles.id, id))
      .get();
    return row ? rowToProfile(row) : null;
  }

  listByTemplate(
    templateId: string,
    templateVersion?: number,
  ): ExperienceInputProfile[] {
    if (templateVersion !== undefined) {
      return this.db.db
        .select()
        .from(experienceInputProfiles)
        .where(
          and(
            eq(experienceInputProfiles.templateId, templateId),
            eq(experienceInputProfiles.templateVersion, templateVersion),
          ),
        )
        .all()
        .map(rowToProfile);
    }
    return this.db.db
      .select()
      .from(experienceInputProfiles)
      .where(eq(experienceInputProfiles.templateId, templateId))
      .all()
      .map(rowToProfile);
  }

  create(input: InputProfileCreateInput): ExperienceInputProfile {
    const now = new Date().toISOString();
    const payload = buildPayload(input);
    this.db.db
      .insert(experienceInputProfiles)
      .values({
        id: input.id,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        mode: input.mode,
        name: input.name,
        revision: 1,
        payloadJson: JSON.stringify(payload),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const saved = this.get(input.id);
    if (!saved) {
      throw new Error(
        `InputProfileRepo: profile ${input.id} not found after insert`,
      );
    }
    return saved;
  }

  createIfAbsent(input: InputProfileCreateInput): ExperienceInputProfile {
    const existing = this.get(input.id);
    if (existing) return existing;
    return this.create(input);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProfileRow = typeof experienceInputProfiles.$inferSelect;

function rowToProfile(row: ProfileRow): ExperienceInputProfile {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  const mode = row.mode as InputMode;

  if (mode === "event_source") {
    return {
      id: row.id,
      templateId: row.templateId,
      templateVersion: row.templateVersion,
      mode: "event_source",
      name: row.name,
      revision: row.revision,
      sourceDefinitionId: payload.sourceDefinitionId as string,
      sourceRevision: payload.sourceRevision as number,
      filters: (payload.filters ?? {}) as Record<string, unknown>,
      analysisTimeframe: payload.analysisTimeframe as TradingTimeframe,
    };
  }

  return {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    mode: "scheduled_scan",
    name: row.name,
    revision: row.revision,
    instrumentSetId: payload.instrumentSetId as string,
    instrumentSetRevision: payload.instrumentSetRevision as number,
    cadence: payload.cadence as CadenceSpec,
    analysisTimeframe: payload.analysisTimeframe as TradingTimeframe,
    marketCalendarId: payload.marketCalendarId as string,
    strategyParameters: (payload.strategyParameters ?? {}) as Record<
      string,
      unknown
    >,
  };
}

function buildPayload(
  input: InputProfileCreateInput,
): Record<string, unknown> {
  if (input.mode === "event_source") {
    return {
      sourceDefinitionId: input.sourceDefinitionId,
      sourceRevision: input.sourceRevision,
      filters: input.filters,
      analysisTimeframe: input.analysisTimeframe,
    };
  }
  return {
    instrumentSetId: input.instrumentSetId,
    instrumentSetRevision: input.instrumentSetRevision,
    cadence: input.cadence,
    analysisTimeframe: input.analysisTimeframe,
    marketCalendarId: input.marketCalendarId,
    strategyParameters: input.strategyParameters,
  };
}
