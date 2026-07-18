import { z } from "zod";
import type { SessionStrategyConfigPatch } from "../session/session-strategy-config-service";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS } from "./capabilities-shared";
import { resolveSession } from "./resolve-session";

export const saveResearchPosture = defineCapability<{
  session: string;
  researchPosture: Record<string, unknown>;
}>({
  key: "save_research_posture",
  label: "Update research posture",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Partial-patch a session's research posture. Read get_strategy first.",
  inputSchema: z.object({
    session: z.string().min(1),
    researchPosture: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update research posture for "${input.session}": ${Object.keys(input.researchPosture).join(", ") || "(no fields)"}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveResearchPosture(
      session.id,
      input.researchPosture as never,
    );
  },
});

export const saveTradeRules = defineCapability<{
  session: string;
  rules: Record<string, unknown>;
}>({
  key: "save_trade_rules",
  label: "Update trade rules",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Partial-patch a session's trade rules. Read get_strategy first.",
  inputSchema: z.object({
    session: z.string().min(1),
    rules: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update trade rules for "${input.session}": ${Object.keys(input.rules).join(", ") || "(no fields)"}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveRules(session.id, input.rules as never);
  },
});

export const saveTimeframeConfig = defineCapability<{
  session: string;
  timeframeConfig: Record<string, unknown>;
}>({
  key: "save_timeframe_config",
  label: "Update timeframe config",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Partial-patch a session's timeframe config. Read get_strategy first.",
  inputSchema: z.object({
    session: z.string().min(1),
    timeframeConfig: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update timeframe config for "${input.session}": ${Object.keys(input.timeframeConfig).join(", ") || "(no fields)"}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveTimeframeConfig(
      session.id,
      input.timeframeConfig as never,
    );
  },
});

export const saveAiSettings = defineCapability<{
  session: string;
  aiSettings: Record<string, unknown>;
}>({
  key: "save_ai_settings",
  label: "Update AI settings",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Partial-patch a session's AI settings. Read get_strategy first.",
  inputSchema: z.object({
    session: z.string().min(1),
    aiSettings: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update AI settings for "${input.session}": ${Object.keys(input.aiSettings).join(", ") || "(no fields)"}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveAiSettings(
      session.id,
      input.aiSettings as never,
    );
  },
});

export const saveSelectorSettings = defineCapability<{
  session: string;
  selectorSettings: Record<string, unknown>;
}>({
  key: "save_selector_settings",
  label: "Update selector settings",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Partial-patch a session's selector settings. Read get_strategy first.",
  inputSchema: z.object({
    session: z.string().min(1),
    selectorSettings: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update selector settings for "${input.session}": ${Object.keys(input.selectorSettings).join(", ") || "(no fields)"}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveSelectorSettings(
      session.id,
      input.selectorSettings as never,
    );
  },
});

export const updateStrategyConfig = defineCapability<{
  session: string;
  patch: Record<string, unknown>;
}>({
  key: "update_strategy_config",
  label: "Update strategy config doc",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Patch the full strategy config document. Version is read internally (optimistic concurrency).",
  inputSchema: z.object({
    session: z.string().min(1),
    patch: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update strategy config doc for "${input.session}" (${Object.keys(input.patch).join(", ") || "empty patch"}).`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const current = services.strategyConfig.get(session.id);
    const record = services.strategyConfig.update(
      session.id,
      input.patch as SessionStrategyConfigPatch,
      current.version,
    );
    return { sessionId: session.id, version: record.version };
  },
});

export const applyStrategyPreset = defineCapability<{
  session: string;
  presetId: string;
}>({
  key: "apply_strategy_preset",
  label: "Apply strategy preset",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Apply a strategy config preset to a session. Version is read internally.",
  inputSchema: z.object({
    session: z.string().min(1),
    presetId: z.string().min(1),
  }),
  describe: (input) =>
    `Apply preset ${input.presetId} to session "${input.session}".`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const current = services.strategyConfig.get(session.id);
    const record = services.strategyConfig.applyPreset(
      session.id,
      input.presetId,
      current.version,
    );
    return { sessionId: session.id, version: record.version };
  },
});

export const rollbackStrategyConfig = defineCapability<{
  session: string;
  version: number;
}>({
  key: "rollback_strategy_config",
  label: "Rollback strategy config",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Rollback a session's strategy config to a prior history version. Current version is read internally.",
  inputSchema: z.object({
    session: z.string().min(1),
    version: z.number().int().positive(),
  }),
  describe: (input) =>
    `Rollback strategy config for "${input.session}" to version ${input.version}.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const current = services.strategyConfig.get(session.id);
    const record = services.strategyConfig.rollback(
      session.id,
      input.version,
      current.version,
    );
    return { sessionId: session.id, version: record.version };
  },
});
