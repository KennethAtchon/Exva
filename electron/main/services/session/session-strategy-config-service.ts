import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
  PipelinePhase,
  SessionAiPhase,
  SessionAiPhaseWorker,
} from "@electron/shared/ai/ai-phase";
import type {
  SessionAiSettings,
  SessionResearchPosture,
  SessionRiskConfig,
  SessionSelectorSettings,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
} from "@/lib/types";
import {
  parseSessionStrategyConfigDoc,
  parseSessionStrategyConfigPartialDoc,
  SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
  type AiPhaseSection,
  type ConfigPresetKind,
  type SessionStrategyConfigDoc,
  type SessionStrategyConfigPartialDoc,
} from "@electron/shared/domain/session-strategy-config";
import { AppError } from "@electron/shared/infra/errors";
import type { DbClient } from "../../db/client";
import {
  configPresets,
  sessionStrategyConfigHistory,
  sessionStrategyConfigs,
} from "../../db/schema";

export type SessionStrategyConfigRecord = {
  version: number;
  schemaVersion: number;
  doc: SessionStrategyConfigDoc;
  updatedAt: string;
};

export type SessionStrategyConfigHistoryEntry = {
  id: string;
  sessionId: string;
  version: number;
  doc: SessionStrategyConfigDoc;
  savedAt: string;
};

export type ConfigPresetRecord = {
  id: string;
  name: string;
  kind: ConfigPresetKind;
  doc: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc;
  builtin: boolean;
  updatedAt: string;
};

/** Section-level patches — objects deep-merge; `ai.phases` replaces when provided. */
export type SessionStrategyConfigPatch = {
  strategy?: Partial<SessionStrategyConfigDoc["strategy"]>;
  risk?: Partial<SessionStrategyConfigDoc["risk"]>;
  timeframe?: Partial<SessionStrategyConfigDoc["timeframe"]>;
  tradeRules?: Partial<SessionStrategyConfigDoc["tradeRules"]>;
  researchPosture?: Partial<SessionStrategyConfigDoc["researchPosture"]>;
  ai?: {
    settings?: Partial<SessionStrategyConfigDoc["ai"]["settings"]>;
    phases?: AiPhaseSection[];
  };
  selector?: Partial<SessionStrategyConfigDoc["selector"]>;
};

function deepMergeObject<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T>,
): T {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (value === undefined) continue;
    const current = base[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      next[key] = deepMergeObject(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function mergeSessionStrategyConfigPatch(
  current: SessionStrategyConfigDoc,
  patch: SessionStrategyConfigPatch,
): SessionStrategyConfigDoc {
  const next: SessionStrategyConfigDoc = {
    ...current,
    strategy: patch.strategy
      ? deepMergeObject(
          current.strategy as unknown as Record<string, unknown>,
          patch.strategy as unknown as Record<string, unknown>,
        )
      : current.strategy,
    risk: patch.risk
      ? deepMergeObject(
          current.risk as unknown as Record<string, unknown>,
          patch.risk as unknown as Record<string, unknown>,
        )
      : current.risk,
    timeframe: patch.timeframe
      ? deepMergeObject(
          current.timeframe as unknown as Record<string, unknown>,
          patch.timeframe as unknown as Record<string, unknown>,
        )
      : current.timeframe,
    tradeRules: patch.tradeRules
      ? deepMergeObject(
          current.tradeRules as unknown as Record<string, unknown>,
          patch.tradeRules as unknown as Record<string, unknown>,
        )
      : current.tradeRules,
    researchPosture: patch.researchPosture
      ? deepMergeObject(
          current.researchPosture as unknown as Record<string, unknown>,
          patch.researchPosture as unknown as Record<string, unknown>,
        )
      : current.researchPosture,
    selector: patch.selector
      ? deepMergeObject(
          current.selector as unknown as Record<string, unknown>,
          patch.selector as unknown as Record<string, unknown>,
        )
      : current.selector,
    ai: patch.ai
      ? {
          settings: patch.ai.settings
            ? {
                ...current.ai.settings,
                ...patch.ai.settings,
              }
            : current.ai.settings,
          phases: patch.ai.phases ?? current.ai.phases,
        }
      : current.ai,
  } as SessionStrategyConfigDoc;

  return parseSessionStrategyConfigDoc(next);
}

export function applyPresetDocByKind(
  current: SessionStrategyConfigDoc,
  kind: ConfigPresetKind,
  presetDoc: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc,
): SessionStrategyConfigDoc {
  if (kind === "full") {
    return parseSessionStrategyConfigDoc({
      ...presetDoc,
      schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
      // Preserve AI phases unless the preset supplies them (full docs usually do).
      ai: "ai" in presetDoc && presetDoc.ai ? presetDoc.ai : current.ai,
      selector:
        "selector" in presetDoc && presetDoc.selector
          ? presetDoc.selector
          : current.selector,
    });
  }

  const patch: SessionStrategyConfigPatch = {};
  if (kind === "risk" && presetDoc.risk) patch.risk = presetDoc.risk;
  if (kind === "timeframe" && presetDoc.timeframe)
    patch.timeframe = presetDoc.timeframe;
  if (kind === "research" && presetDoc.researchPosture)
    patch.researchPosture = presetDoc.researchPosture;
  if (kind === "rules" && presetDoc.tradeRules)
    patch.tradeRules = presetDoc.tradeRules;
  if (kind === "ai" && presetDoc.ai) patch.ai = presetDoc.ai;
  return mergeSessionStrategyConfigPatch(current, patch);
}

export function docToSessionStrategyContext(
  sessionId: string,
  doc: SessionStrategyConfigDoc,
  updatedAt: string,
): SessionStrategyContext {
  return {
    researchPosture: {
      sessionId,
      ...doc.researchPosture,
      updatedAt,
    },
    rules: {
      sessionId,
      ...doc.tradeRules,
      updatedAt,
    },
    riskConfig: {
      sessionId,
      ...doc.risk,
      updatedAt,
    },
    timeframe: {
      sessionId,
      ...doc.timeframe,
      updatedAt,
    },
    aiSettings: {
      sessionId,
      ...doc.ai.settings,
      updatedAt,
    },
  };
}

export function docToSelectorSettings(
  sessionId: string,
  doc: SessionStrategyConfigDoc,
  updatedAt: string,
): SessionSelectorSettings {
  return {
    sessionId,
    ...doc.selector,
    updatedAt,
  };
}

export function docToAiPhases(
  sessionId: string,
  doc: SessionStrategyConfigDoc,
  updatedAt: string,
): SessionAiPhase[] {
  return doc.ai.phases.map((phase) => ({
    sessionId,
    phase: phase.phase,
    providerKey: phase.providerKey,
    modelId: phase.modelId,
    temperature: phase.temperature,
    maxTokens: phase.maxTokens,
    reasoningLevel: phase.reasoningLevel,
    promptSource: phase.promptSource,
    promptMarkdown: phase.promptMarkdown,
    updatedAt,
  }));
}

export function docToAiPhaseWorkers(
  sessionId: string,
  doc: SessionStrategyConfigDoc,
  updatedAt: string,
): SessionAiPhaseWorker[] {
  return doc.ai.phases.flatMap((phase) =>
    phase.workers.map((worker) => ({
      sessionId,
      phase: phase.phase,
      workerId: worker.workerId,
      providerKey: worker.providerKey,
      modelId: worker.modelId,
      maxSteps: worker.maxSteps,
      spendLimitUsd: worker.spendLimitUsd,
      promptMarkdown: worker.promptMarkdown,
      updatedAt,
    })),
  );
}

function stripSessionMeta<T extends { sessionId?: string; updatedAt?: string }>(
  patch: Partial<T>,
): Omit<Partial<T>, "sessionId" | "updatedAt"> {
  const rest = { ...patch };
  delete rest.sessionId;
  delete rest.updatedAt;
  return rest;
}

export class SessionStrategyConfigService {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionStrategyConfigRecord {
    const row = this.client.db
      .select()
      .from(sessionStrategyConfigs)
      .where(eq(sessionStrategyConfigs.sessionId, sessionId))
      .get();
    if (!row) {
      throw new AppError(
        `Strategy config for session ${sessionId} was not found`,
        "NOT_FOUND",
        { sessionId },
      );
    }
    return {
      version: row.version,
      schemaVersion: row.schemaVersion,
      doc: parseSessionStrategyConfigDoc(row.doc),
      updatedAt: row.updatedAt,
    };
  }

  getContext(sessionId: string): SessionStrategyContext {
    const record = this.get(sessionId);
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt);
  }

  getSelectorSettings(sessionId: string): SessionSelectorSettings {
    const record = this.get(sessionId);
    return docToSelectorSettings(sessionId, record.doc, record.updatedAt);
  }

  getResearchPosture(sessionId: string): SessionResearchPosture {
    return this.getContext(sessionId).researchPosture;
  }

  getRules(sessionId: string): SessionTradeRules {
    return this.getContext(sessionId).rules;
  }

  getRiskConfig(sessionId: string): SessionRiskConfig {
    return this.getContext(sessionId).riskConfig;
  }

  getTimeframeConfig(sessionId: string): SessionTimeframeConfig {
    return this.getContext(sessionId).timeframe;
  }

  getAiSettings(sessionId: string): SessionAiSettings {
    return this.getContext(sessionId).aiSettings;
  }

  listAiPhases(sessionId: string): SessionAiPhase[] {
    const record = this.get(sessionId);
    return docToAiPhases(sessionId, record.doc, record.updatedAt);
  }

  getAiPhase(sessionId: string, phase: PipelinePhase): SessionAiPhase | null {
    return (
      this.listAiPhases(sessionId).find((row) => row.phase === phase) ?? null
    );
  }

  listAiPhaseWorkers(sessionId: string): SessionAiPhaseWorker[] {
    const record = this.get(sessionId);
    return docToAiPhaseWorkers(sessionId, record.doc, record.updatedAt);
  }

  getAiPhaseWorker(
    sessionId: string,
    phase: PipelinePhase,
    workerId: string,
  ): SessionAiPhaseWorker | null {
    return (
      this.listAiPhaseWorkers(sessionId).find(
        (row) => row.phase === phase && row.workerId === workerId,
      ) ?? null
    );
  }

  update(
    sessionId: string,
    patch: SessionStrategyConfigPatch,
    expectedVersion: number,
  ): SessionStrategyConfigRecord {
    return this.writeNext(sessionId, expectedVersion, (current) =>
      mergeSessionStrategyConfigPatch(current, patch),
    );
  }

  applyPreset(
    sessionId: string,
    presetId: string,
    expectedVersion: number,
  ): SessionStrategyConfigRecord {
    const preset = this.requirePreset(presetId);
    return this.writeNext(sessionId, expectedVersion, (current) =>
      applyPresetDocByKind(current, preset.kind, preset.doc),
    );
  }

  history(sessionId: string): SessionStrategyConfigHistoryEntry[] {
    return this.client.db
      .select()
      .from(sessionStrategyConfigHistory)
      .where(eq(sessionStrategyConfigHistory.sessionId, sessionId))
      .orderBy(desc(sessionStrategyConfigHistory.version))
      .all()
      .map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        version: row.version,
        doc: parseSessionStrategyConfigDoc(row.doc),
        savedAt: row.savedAt,
      }));
  }

  rollback(
    sessionId: string,
    version: number,
    expectedVersion: number,
  ): SessionStrategyConfigRecord {
    const entry = this.client.db
      .select()
      .from(sessionStrategyConfigHistory)
      .where(
        and(
          eq(sessionStrategyConfigHistory.sessionId, sessionId),
          eq(sessionStrategyConfigHistory.version, version),
        ),
      )
      .get();
    if (!entry) {
      throw new AppError(
        `Config history version ${version} for session ${sessionId} was not found`,
        "NOT_FOUND",
        { sessionId, version },
      );
    }
    const priorDoc = parseSessionStrategyConfigDoc(entry.doc);
    return this.writeNext(sessionId, expectedVersion, () => priorDoc);
  }

  listPresets(kind?: ConfigPresetKind): ConfigPresetRecord[] {
    const rows = this.client.db.select().from(configPresets).all();
    return rows
      .filter((row) => (kind ? row.kind === kind : true))
      .map((row) => this.toPresetRecord(row));
  }

  savePreset(input: {
    id?: string;
    name: string;
    kind: ConfigPresetKind;
    doc: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc;
    builtin?: boolean;
  }): ConfigPresetRecord {
    const now = new Date().toISOString();
    const id = input.id?.trim() || `${input.kind}/${randomUUID()}`;
    const existing = this.client.db
      .select()
      .from(configPresets)
      .where(eq(configPresets.id, id))
      .get();

    if (existing?.builtin) {
      throw new AppError(
        "Built-in presets cannot be overwritten.",
        "FORBIDDEN",
        {
          id,
        },
      );
    }

    const validated =
      input.kind === "full"
        ? parseSessionStrategyConfigDoc(input.doc)
        : parseSessionStrategyConfigPartialDoc(input.doc);

    if (existing) {
      this.client.db
        .update(configPresets)
        .set({
          name: input.name,
          kind: input.kind,
          doc: validated,
          updatedAt: now,
        })
        .where(eq(configPresets.id, id))
        .run();
    } else {
      this.client.db
        .insert(configPresets)
        .values({
          id,
          name: input.name,
          kind: input.kind,
          doc: validated,
          builtin: input.builtin ?? false,
          updatedAt: now,
        })
        .run();
    }

    return this.requirePreset(id);
  }

  deletePreset(id: string): void {
    const existing = this.client.db
      .select()
      .from(configPresets)
      .where(eq(configPresets.id, id))
      .get();
    if (!existing) {
      throw new AppError(`Config preset ${id} was not found`, "NOT_FOUND", {
        id,
      });
    }
    if (existing.builtin) {
      throw new AppError("Built-in presets cannot be deleted.", "FORBIDDEN", {
        id,
      });
    }
    this.client.db.delete(configPresets).where(eq(configPresets.id, id)).run();
  }

  /** Insert version-1 row for a newly created session (idempotent if exists). */
  insertInitial(sessionId: string, doc: SessionStrategyConfigDoc): void {
    const existing = this.client.db
      .select({ sessionId: sessionStrategyConfigs.sessionId })
      .from(sessionStrategyConfigs)
      .where(eq(sessionStrategyConfigs.sessionId, sessionId))
      .get();
    if (existing) return;
    const validated = parseSessionStrategyConfigDoc(doc);
    this.client.db
      .insert(sessionStrategyConfigs)
      .values({
        sessionId,
        version: 1,
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        doc: validated,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  /** Copy config doc from source session to target (version 1). */
  copyFromSession(sourceSessionId: string, targetSessionId: string): void {
    const source = this.get(sourceSessionId);
    this.insertInitial(targetSessionId, source.doc);
  }

  backfillMissingProviderModel(defaults: {
    providerKey: string;
    modelId: string;
  }): number {
    if (!defaults.providerKey.trim() || !defaults.modelId.trim()) return 0;
    const rows = this.client.db.select().from(sessionStrategyConfigs).all();
    let updated = 0;
    for (const row of rows) {
      const doc = parseSessionStrategyConfigDoc(row.doc);
      let changed = false;
      const phases = doc.ai.phases.map((phase) => {
        if (phase.providerKey.trim() && phase.modelId.trim()) return phase;
        changed = true;
        return {
          ...phase,
          providerKey: phase.providerKey.trim()
            ? phase.providerKey
            : defaults.providerKey,
          modelId: phase.modelId.trim() ? phase.modelId : defaults.modelId,
        };
      });
      if (!changed) continue;
      this.writeNext(row.sessionId, row.version, () =>
        parseSessionStrategyConfigDoc({ ...doc, ai: { ...doc.ai, phases } }),
      );
      updated += 1;
    }
    return updated;
  }

  backfillDefaultReasoningLevel(
    reasoningLevel: SessionAiPhase["reasoningLevel"],
  ): number {
    if (reasoningLevel === "off") return 0;
    const rows = this.client.db.select().from(sessionStrategyConfigs).all();
    let updated = 0;
    for (const row of rows) {
      const doc = parseSessionStrategyConfigDoc(row.doc);
      let changed = false;
      const phases = doc.ai.phases.map((phase) => {
        if (phase.reasoningLevel !== "off") return phase;
        changed = true;
        return { ...phase, reasoningLevel };
      });
      if (!changed) continue;
      this.writeNext(row.sessionId, row.version, () =>
        parseSessionStrategyConfigDoc({ ...doc, ai: { ...doc.ai, phases } }),
      );
      updated += 1;
    }
    return updated;
  }

  /** Convenience patches used by legacy strategy:* adapters (auto-version). */
  patchWithCurrentVersion(
    sessionId: string,
    patch: SessionStrategyConfigPatch,
  ): SessionStrategyConfigRecord {
    const current = this.get(sessionId);
    return this.update(sessionId, patch, current.version);
  }

  patchResearchPosture(
    sessionId: string,
    patch: Partial<SessionResearchPosture>,
  ): SessionResearchPosture {
    const record = this.patchWithCurrentVersion(sessionId, {
      researchPosture: stripSessionMeta(patch),
    });
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt)
      .researchPosture;
  }

  patchRules(
    sessionId: string,
    patch: Partial<SessionTradeRules>,
  ): SessionTradeRules {
    const record = this.patchWithCurrentVersion(sessionId, {
      tradeRules: stripSessionMeta(patch),
    });
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt)
      .rules;
  }

  patchRiskConfig(
    sessionId: string,
    patch: Partial<SessionRiskConfig>,
  ): SessionRiskConfig {
    const record = this.patchWithCurrentVersion(sessionId, {
      risk: stripSessionMeta(patch),
    });
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt)
      .riskConfig;
  }

  patchTimeframe(
    sessionId: string,
    patch: Partial<SessionTimeframeConfig>,
  ): SessionTimeframeConfig {
    const record = this.patchWithCurrentVersion(sessionId, {
      timeframe: stripSessionMeta(patch),
    });
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt)
      .timeframe;
  }

  patchAiSettings(
    sessionId: string,
    patch: Partial<SessionAiSettings>,
  ): SessionAiSettings {
    const record = this.patchWithCurrentVersion(sessionId, {
      ai: { settings: stripSessionMeta(patch) },
    });
    return docToSessionStrategyContext(sessionId, record.doc, record.updatedAt)
      .aiSettings;
  }

  patchSelectorSettings(
    sessionId: string,
    patch: Partial<SessionSelectorSettings>,
  ): SessionSelectorSettings {
    const record = this.patchWithCurrentVersion(sessionId, {
      selector: stripSessionMeta(patch),
    });
    return docToSelectorSettings(sessionId, record.doc, record.updatedAt);
  }

  patchAiPhase(
    sessionId: string,
    patch: Partial<SessionAiPhase> & { phase: PipelinePhase },
  ): SessionAiPhase {
    const current = this.get(sessionId);
    const phases = current.doc.ai.phases.map((phase) => {
      if (phase.phase !== patch.phase) return phase;
      return {
        ...phase,
        ...(patch.providerKey !== undefined
          ? { providerKey: patch.providerKey }
          : {}),
        ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
        ...(patch.temperature !== undefined
          ? { temperature: patch.temperature }
          : {}),
        ...(patch.maxTokens !== undefined
          ? { maxTokens: patch.maxTokens }
          : {}),
        ...(patch.reasoningLevel !== undefined
          ? { reasoningLevel: patch.reasoningLevel }
          : {}),
        ...(patch.promptSource !== undefined
          ? { promptSource: patch.promptSource }
          : {}),
        ...(patch.promptMarkdown !== undefined
          ? { promptMarkdown: patch.promptMarkdown }
          : {}),
      };
    });
    if (!phases.some((phase) => phase.phase === patch.phase)) {
      throw new AppError(
        `AI phase ${patch.phase} is not configured for this session.`,
        "NOT_FOUND",
        { sessionId, phase: patch.phase },
      );
    }
    const record = this.update(sessionId, { ai: { phases } }, current.version);
    const saved = docToAiPhases(sessionId, record.doc, record.updatedAt).find(
      (phase) => phase.phase === patch.phase,
    );
    if (!saved) {
      throw new AppError(
        `AI phase ${patch.phase} is not configured for this session.`,
        "NOT_FOUND",
        { sessionId, phase: patch.phase },
      );
    }
    return saved;
  }

  patchAiPhaseWorker(
    sessionId: string,
    patch: SessionAiPhaseWorker,
  ): SessionAiPhaseWorker {
    const current = this.get(sessionId);
    const phaseExists = current.doc.ai.phases.some(
      (phase) => phase.phase === patch.phase,
    );
    if (!phaseExists) {
      throw new AppError(
        `AI phase ${patch.phase} is not configured for this session.`,
        "NOT_FOUND",
        { sessionId, phase: patch.phase },
      );
    }
    const phases = current.doc.ai.phases.map((phase) => {
      if (phase.phase !== patch.phase) return phase;
      const without = phase.workers.filter(
        (w) => w.workerId !== patch.workerId,
      );
      return {
        ...phase,
        workers: [
          ...without,
          {
            workerId: patch.workerId,
            providerKey: patch.providerKey ?? null,
            modelId: patch.modelId ?? null,
            maxSteps: patch.maxSteps ?? null,
            spendLimitUsd: patch.spendLimitUsd ?? null,
            promptMarkdown: patch.promptMarkdown ?? null,
          },
        ],
      };
    });
    const record = this.update(sessionId, { ai: { phases } }, current.version);
    const saved = docToAiPhaseWorkers(
      sessionId,
      record.doc,
      record.updatedAt,
    ).find(
      (worker) =>
        worker.phase === patch.phase && worker.workerId === patch.workerId,
    );
    if (!saved) {
      throw new AppError(
        `AI phase worker ${patch.workerId} was not saved.`,
        "INTERNAL_ERROR",
        { sessionId, phase: patch.phase, workerId: patch.workerId },
      );
    }
    return saved;
  }

  private writeNext(
    sessionId: string,
    expectedVersion: number,
    nextDocFromCurrent: (
      current: SessionStrategyConfigDoc,
    ) => SessionStrategyConfigDoc,
  ): SessionStrategyConfigRecord {
    const current = this.get(sessionId);
    const nextDoc = parseSessionStrategyConfigDoc(
      nextDocFromCurrent(current.doc),
    );
    const now = new Date().toISOString();
    const nextVersion = expectedVersion + 1;

    let wrote = false;
    this.client.db.transaction((tx) => {
      // Compare-and-swap inside the transaction: exactly one writer wins.
      const updateResult = tx
        .update(sessionStrategyConfigs)
        .set({
          version: nextVersion,
          schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
          doc: nextDoc,
          updatedAt: now,
        })
        .where(
          and(
            eq(sessionStrategyConfigs.sessionId, sessionId),
            eq(sessionStrategyConfigs.version, expectedVersion),
          ),
        )
        .run();

      if (updateResult.changes !== 1) {
        const actual = tx
          .select({ version: sessionStrategyConfigs.version })
          .from(sessionStrategyConfigs)
          .where(eq(sessionStrategyConfigs.sessionId, sessionId))
          .get();
        throw new AppError(
          `Strategy config version mismatch for session ${sessionId}: expected ${expectedVersion}, found ${actual?.version ?? "missing"}`,
          "STALE_VERSION",
          {
            sessionId,
            expectedVersion,
            actualVersion: actual?.version ?? null,
          },
        );
      }

      tx.insert(sessionStrategyConfigHistory)
        .values({
          id: randomUUID(),
          sessionId,
          version: expectedVersion,
          doc: current.doc,
          savedAt: now,
        })
        .run();
      wrote = true;
    });

    if (!wrote) {
      throw new AppError(
        `Strategy config write did not commit for session ${sessionId}`,
        "INTERNAL_ERROR",
        { sessionId },
      );
    }

    return {
      version: nextVersion,
      schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
      doc: nextDoc,
      updatedAt: now,
    };
  }

  private requirePreset(id: string): ConfigPresetRecord {
    const row = this.client.db
      .select()
      .from(configPresets)
      .where(eq(configPresets.id, id))
      .get();
    if (!row) {
      throw new AppError(`Config preset ${id} was not found`, "NOT_FOUND", {
        id,
      });
    }
    return this.toPresetRecord(row);
  }

  private toPresetRecord(
    row: typeof configPresets.$inferSelect,
  ): ConfigPresetRecord {
    const kind = row.kind as ConfigPresetKind;
    const doc =
      kind === "full"
        ? parseSessionStrategyConfigDoc(row.doc)
        : parseSessionStrategyConfigPartialDoc(row.doc);
    return {
      id: row.id,
      name: row.name,
      kind,
      doc,
      builtin: row.builtin,
      updatedAt: row.updatedAt,
    };
  }
}
