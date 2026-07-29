import type { PhaseRuntimeSummary } from "@electron/shared/ai/ai-phase";
import type { SessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config";
import { defaultSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config-defaults";
import { builtInGlobalStrategyPresets } from "../../electron/shared/presets";
import type { GlobalStrategyPreset } from "../../electron/shared/presets";
import {
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  RESEARCH_POSTURE_PRESETS,
  TRADE_RULE_PRESETS,
} from "../../electron/shared/presets";
import type { UserGlobalPresetRow } from "@/lib/exva";
import type {
  SessionAiSettings,
  SessionResearchPosture,
  SessionRiskConfig,
  SessionTradeRules,
  SessionTimeframeConfig,
} from "@/lib/types";

export type FullPresetSectionIds = {
  posturePresetId: GlobalStrategyPreset["posturePresetId"];
  rulesPresetId: GlobalStrategyPreset["rulesPresetId"];
  riskPresetId: GlobalStrategyPreset["riskPresetId"];
  timeframePresetId: GlobalStrategyPreset["timeframePresetId"];
};
export type StrategyConfigPresetRow = {
  id: string;
  name: string;
  kind: string;
  doc: unknown;
  builtin: boolean;
  updatedAt: string;
};

export type StrategyConfigRecord = {
  version: number;
  schemaVersion: number;
  doc: SessionStrategyConfigDoc;
  updatedAt: string;
};

const SECTION_KEYS = [
  "strategy",
  "risk",
  "timeframe",
  "tradeRules",
  "researchPosture",
  "ai",
  "selector",
] as const;

export type ConfigSectionDiff = {
  section: (typeof SECTION_KEYS)[number];
  changed: boolean;
  before: string;
  after: string;
};

export function isStaleVersionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "STALE_VERSION") return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    (message.includes("STALE_VERSION") ||
      message.includes("version mismatch") ||
      /expected \d+, found \d+/.test(message))
  );
}

export function staleVersionUserMessage(): string {
  return "Config changed elsewhere (version conflict). Reloaded the latest version — re-apply your edits and save again.";
}

export function mapDocToUiSections(
  sessionId: string,
  doc: SessionStrategyConfigDoc,
  updatedAt: string,
): {
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiSettings: SessionAiSettings;
  aiPhases: PhaseRuntimeSummary[];
} {
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
    aiPhases: doc.ai.phases.map((phase) => ({
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
      workerOverrides: phase.workers.map((worker) => ({
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
    })),
  };
}

function stripMeta<T extends { sessionId?: string; updatedAt?: string }>(
  value: T,
): Omit<T, "sessionId" | "updatedAt"> {
  const rest = { ...value };
  delete rest.sessionId;
  delete rest.updatedAt;
  return rest;
}

export function buildStrategyConfigPatch(input: {
  dirtyFields: Set<string>;
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiSettings: SessionAiSettings;
  aiPhases: PhaseRuntimeSummary[];
}): Record<string, unknown> {
  const { dirtyFields } = input;
  const patch: Record<string, unknown> = {};
  const dirty = [...dirtyFields];

  if (dirty.some((field) => field.startsWith("researchPosture."))) {
    patch.researchPosture = stripMeta(input.researchPosture);
  }
  if (dirty.some((field) => field.startsWith("rules."))) {
    patch.tradeRules = stripMeta(input.rules);
  }
  if (dirty.some((field) => field.startsWith("riskConfig."))) {
    patch.risk = stripMeta(input.riskConfig);
  }
  if (dirty.some((field) => field.startsWith("timeframe."))) {
    patch.timeframe = stripMeta(input.timeframe);
  }

  const aiSettingsDirty = dirtyFields.has("aiSettings.workerGuidanceMarkdown");
  const aiPhasesDirty = dirty.some((field) => field.startsWith("aiPhases."));
  if (aiSettingsDirty || aiPhasesDirty) {
    patch.ai = {
      ...(aiSettingsDirty
        ? {
            settings: {
              workerGuidanceMarkdown: input.aiSettings.workerGuidanceMarkdown,
            },
          }
        : {}),
      ...(aiPhasesDirty
        ? {
            phases: input.aiPhases.map((phase) => ({
              phase: phase.phase,
              providerKey: phase.providerKey,
              modelId: phase.modelId,
              temperature: phase.temperature,
              maxTokens: phase.maxTokens,
              reasoningLevel: phase.reasoningLevel,
              promptSource: phase.promptSource,
              promptMarkdown: phase.promptMarkdown,
              workers: (phase.workerOverrides ?? []).map((worker) => ({
                workerId: worker.workerId,
                providerKey: worker.providerKey,
                modelId: worker.modelId,
                maxSteps: worker.maxSteps,
                spendLimitUsd: worker.spendLimitUsd,
                promptMarkdown: worker.promptMarkdown,
              })),
            })),
          }
        : {}),
    };
  }

  return patch;
}

export function configPresetToUserGlobalRow(
  preset: StrategyConfigPresetRow,
): UserGlobalPresetRow {
  const doc = (preset.doc ?? {}) as {
    researchPosture?: { posturePresetId?: string };
    tradeRules?: { rulesPresetId?: string };
    risk?: { riskPresetId?: string };
    timeframe?: { timeframePresetId?: string };
  };
  const shortId = preset.id.startsWith("full/")
    ? preset.id.slice("full/".length)
    : preset.id;
  const builtIn = builtInGlobalStrategyPresets().find((p) => p.id === shortId);

  const global: GlobalStrategyPreset = {
    id: preset.id,
    label: preset.name,
    description: builtIn?.description ?? "",
    summaryBullets: builtIn?.summaryBullets ?? [],
    posturePresetId:
      (doc.researchPosture
        ?.posturePresetId as GlobalStrategyPreset["posturePresetId"]) ??
      builtIn?.posturePresetId ??
      "custom",
    rulesPresetId:
      (doc.tradeRules
        ?.rulesPresetId as GlobalStrategyPreset["rulesPresetId"]) ??
      builtIn?.rulesPresetId ??
      "custom",
    riskPresetId:
      (doc.risk?.riskPresetId as GlobalStrategyPreset["riskPresetId"]) ??
      builtIn?.riskPresetId ??
      "custom",
    timeframePresetId:
      (doc.timeframe
        ?.timeframePresetId as GlobalStrategyPreset["timeframePresetId"]) ??
      builtIn?.timeframePresetId ??
      "custom",
  };

  return {
    id: preset.id,
    name: preset.name,
    isBuiltIn: preset.builtin,
    createdAt: Date.parse(preset.updatedAt) || Date.now(),
    presetJson: JSON.stringify(global),
  };
}

export function assembleFullPresetDocFromSectionIds(
  input: FullPresetSectionIds,
): SessionStrategyConfigDoc {
  const base = defaultSessionStrategyConfigDoc();
  const posture = RESEARCH_POSTURE_PRESETS.find(
    (entry) => entry.id === input.posturePresetId,
  );
  const rules = TRADE_RULE_PRESETS.find(
    (entry) => entry.id === input.rulesPresetId,
  );
  const risk = RISK_PRESETS.find((entry) => entry.id === input.riskPresetId);
  const timeframe = TIMEFRAME_PRESETS.find(
    (entry) => entry.id === input.timeframePresetId,
  );

  return {
    ...base,
    researchPosture: posture
      ? { ...base.researchPosture, ...posture.posture }
      : base.researchPosture,
    tradeRules: rules
      ? { ...base.tradeRules, ...rules.rules }
      : base.tradeRules,
    risk: risk
      ? { ...base.risk, riskPresetId: risk.id, ...risk.values }
      : base.risk,
    timeframe: timeframe
      ? {
          ...base.timeframe,
          timeframePresetId: timeframe.id,
          ...timeframe.values,
        }
      : base.timeframe,
  };
}

export function diffConfigDocs(
  before: unknown,
  after: unknown,
): ConfigSectionDiff[] {
  const beforeDoc = (before ?? {}) as Record<string, unknown>;
  const afterDoc = (after ?? {}) as Record<string, unknown>;
  return SECTION_KEYS.map((section) => {
    const left = JSON.stringify(beforeDoc[section] ?? null, null, 2);
    const right = JSON.stringify(afterDoc[section] ?? null, null, 2);
    return {
      section,
      changed: left !== right,
      before: left,
      after: right,
    };
  });
}

export function formatConfigSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;
  return date.toLocaleString();
}
