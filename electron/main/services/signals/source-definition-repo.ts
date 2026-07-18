import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sourceDefinitions, sourceDefinitionRevisions } from "../../db/schema";
import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import type { LiveSignalSourceType } from "@electron/shared/domain/signals";
import { requireJsonParse } from "../infra/safe-json-parse";

export interface SourceDefinitionCreateInput {
  id: string;
  kind: LiveSignalSourceType;
  name: string;
  description?: string | null;
  enabled?: boolean;
  integrationId?: string | null;
  outputContractId: string;
  configSchemaVersion?: number;
  config?: Record<string, unknown>;
}

export class SourceDefinitionRepo {
  constructor(private readonly db: DbClient) {}

  get(id: string): SourceDefinition | null {
    const defRow = this.db.db
      .select()
      .from(sourceDefinitions)
      .where(eq(sourceDefinitions.id, id))
      .get();
    if (!defRow) return null;

    const latestRev = this.getLatestRevision(id);
    return rowToDefinition(defRow, latestRev);
  }

  list(): SourceDefinition[] {
    const rows = this.db.db.select().from(sourceDefinitions).all();
    return rows.map((row) => {
      const rev = this.getLatestRevision(row.id);
      return rowToDefinition(row, rev);
    });
  }

  listByKind(kind: LiveSignalSourceType): SourceDefinition[] {
    const rows = this.db.db
      .select()
      .from(sourceDefinitions)
      .where(eq(sourceDefinitions.kind, kind))
      .all();
    return rows.map((row) => {
      const rev = this.getLatestRevision(row.id);
      return rowToDefinition(row, rev);
    });
  }

  getRevision(
    sourceDefinitionId: string,
    revision: number,
  ): { revision: number; config: Record<string, unknown> } | null {
    const row = this.db.db
      .select()
      .from(sourceDefinitionRevisions)
      .where(
        and(
          eq(sourceDefinitionRevisions.sourceDefinitionId, sourceDefinitionId),
          eq(sourceDefinitionRevisions.revision, revision),
        ),
      )
      .get();
    if (!row) return null;
    return {
      revision: row.revision,
      config: requireJsonParse<Record<string, unknown>>(
        row.configJson,
        undefined,
        "Invalid source definition configJson",
      ),
    };
  }

  private getLatestRevision(
    sourceDefinitionId: string,
  ): { revision: number; config: Record<string, unknown> } | null {
    const rows = this.db.db
      .select()
      .from(sourceDefinitionRevisions)
      .where(
        eq(sourceDefinitionRevisions.sourceDefinitionId, sourceDefinitionId),
      )
      .all();
    if (rows.length === 0) return null;
    const latest = rows.reduce((max, r) =>
      r.revision > max.revision ? r : max,
    );
    return {
      revision: latest.revision,
      config: requireJsonParse<Record<string, unknown>>(
        latest.configJson,
        undefined,
        "Invalid source definition configJson",
      ),
    };
  }

  create(input: SourceDefinitionCreateInput): SourceDefinition {
    const now = new Date().toISOString();
    this.db.db
      .insert(sourceDefinitions)
      .values({
        id: input.id,
        kind: input.kind,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled ?? true,
        integrationId: input.integrationId ?? null,
        outputContractId: input.outputContractId,
        configSchemaVersion: input.configSchemaVersion ?? 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const config = input.config ?? {};
    this.db.db
      .insert(sourceDefinitionRevisions)
      .values({
        sourceDefinitionId: input.id,
        revision: 1,
        configJson: JSON.stringify(config),
        createdAt: now,
      })
      .run();

    const saved = this.get(input.id);
    if (!saved) {
      throw new Error(
        `SourceDefinitionRepo: definition ${input.id} not found after insert`,
      );
    }
    return saved;
  }

  /**
   * Create a new config revision. Source definition header fields cannot
   * be mutated — only config revisions are appended.
   */
  createRevision(
    sourceDefinitionId: string,
    config: Record<string, unknown>,
  ): number {
    const existing = this.db.db
      .select()
      .from(sourceDefinitionRevisions)
      .where(
        eq(sourceDefinitionRevisions.sourceDefinitionId, sourceDefinitionId),
      )
      .all();
    const nextRevision = existing.length + 1;
    const now = new Date().toISOString();
    this.db.db
      .insert(sourceDefinitionRevisions)
      .values({
        sourceDefinitionId,
        revision: nextRevision,
        configJson: JSON.stringify(config),
        createdAt: now,
      })
      .run();
    return nextRevision;
  }

  /** Idempotent seed helper. */
  createIfAbsent(input: SourceDefinitionCreateInput): SourceDefinition {
    const existing = this.get(input.id);
    if (existing) return existing;
    return this.create(input);
  }

  setEnabled(id: string, enabled: boolean): SourceDefinition {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`SourceDefinitionRepo: definition ${id} not found`);
    }
    const now = new Date().toISOString();
    this.db.db
      .update(sourceDefinitions)
      .set({ enabled, updatedAt: now })
      .where(eq(sourceDefinitions.id, id))
      .run();
    const saved = this.get(id);
    if (!saved) {
      throw new Error(
        `SourceDefinitionRepo: definition ${id} missing after setEnabled`,
      );
    }
    return saved;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DefRow = typeof sourceDefinitions.$inferSelect;

function rowToDefinition(
  row: DefRow,
  latestRev: { revision: number; config: Record<string, unknown> } | null,
): SourceDefinition {
  return {
    id: row.id,
    kind: row.kind as LiveSignalSourceType,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    integrationId: row.integrationId,
    outputContractId: row.outputContractId,
    configSchemaVersion: row.configSchemaVersion,
    config: latestRev?.config ?? {},
    revision: latestRev?.revision ?? 0,
  };
}
