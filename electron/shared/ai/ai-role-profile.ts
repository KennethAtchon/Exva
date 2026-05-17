import { z } from "zod";

export const AI_ROLE_PROFILE_VERSION = 1 as const;
export const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN = 1 as const;
export const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX = 60 as const;
export const DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES = 5 as const;
export const SELECTOR_STEP_SETTING_MIN = 1 as const;
export const SELECTOR_STEP_SETTING_MAX = 50 as const;
export const DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS = 8 as const;
export const DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS = 6 as const;
export const DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS = 2 as const;
export const DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS = 2 as const;
export const DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION = 3 as const;
export const DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP = 14 as const;

export const aiRoleToolModeSchema = z.enum(["disabled", "optional", "preferred", "required"]);

export const aiRoleToolPolicyEntrySchema = z
  .object({
    mode: aiRoleToolModeSchema.optional(),
    notes: z.string().optional(),
  })
  .catchall(z.unknown());

export const aiRoleProfileMethodSchema = z
  .object({
    checklist: z.array(z.string().min(1)).default([]),
    requiredEvidence: z.array(z.string().min(1)).default([]),
    avoid: z.array(z.string().min(1)).default([]),
  })
  .catchall(z.unknown())
  .default({});

export const aiRoleProfileOutputSchema = z
  .object({
    format: z.enum(["memo", "structured_json", "candidate_list", "custom"]).optional(),
    requiredSections: z.array(z.string().min(1)).default([]),
    minWords: z.number().int().nonnegative().nullable().optional(),
    maxWords: z.number().int().nonnegative().nullable().optional(),
    terminalAction: z.string().optional(),
  })
  .catchall(z.unknown())
  .default({});

export const selectorRoleSettingsSchema = z
  .object({
    noInstrumentRetryMinutes: z
      .number()
      .int()
      .min(SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN)
      .max(SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX)
      .optional(),
    maxDiscoverySteps: z
      .number()
      .int()
      .min(SELECTOR_STEP_SETTING_MIN)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
    maxVerificationSteps: z
      .number()
      .int()
      .min(SELECTOR_STEP_SETTING_MIN)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
    maxNoNewInfoSteps: z
      .number()
      .int()
      .min(SELECTOR_STEP_SETTING_MIN)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
    maxRepeatedSymbolChecks: z
      .number()
      .int()
      .min(SELECTOR_STEP_SETTING_MIN)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
    minCandidatesBeforeVerification: z
      .number()
      .int()
      .min(1)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
    forceSubmitAfterStep: z
      .number()
      .int()
      .min(SELECTOR_STEP_SETTING_MIN)
      .max(SELECTOR_STEP_SETTING_MAX)
      .optional(),
  })
  .catchall(z.unknown())
  .optional();

export const aiRoleProfileDocumentSchema = z
  .object({
    version: z.literal(AI_ROLE_PROFILE_VERSION),
    objective: z.string().max(240).optional(),
    constraints: z.array(z.string().min(1)).default([]),
    toolPolicy: z.record(z.string(), aiRoleToolPolicyEntrySchema).default({}),
    method: aiRoleProfileMethodSchema,
    output: aiRoleProfileOutputSchema,
    selectorSettings: selectorRoleSettingsSchema,
  })
  .catchall(z.unknown());

export type AiRoleToolMode = z.infer<typeof aiRoleToolModeSchema>;
export type AiRoleToolPolicyEntry = z.infer<typeof aiRoleToolPolicyEntrySchema>;
export type AiRoleProfileDocument = z.infer<typeof aiRoleProfileDocumentSchema>;
export type SelectorRoleSettings = NonNullable<z.infer<typeof selectorRoleSettingsSchema>>;

export interface ResolvedSelectorRoleSettings {
  noInstrumentRetryMinutes: number;
  maxDiscoverySteps: number;
  maxVerificationSteps: number;
  maxNoNewInfoSteps: number;
  maxRepeatedSymbolChecks: number;
  minCandidatesBeforeVerification: number;
  forceSubmitAfterStep: number;
}

export function normalizeAiRoleProfileDocument(
  input: unknown,
  fallback?: AiRoleProfileDocument,
): AiRoleProfileDocument {
  const parsed = aiRoleProfileDocumentSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return fallback ? cloneAiRoleProfileDocument(fallback) : aiRoleProfileDocumentSchema.parse({ version: AI_ROLE_PROFILE_VERSION });
}

export function resolveSelectorNoInstrumentRetryMinutes(document: AiRoleProfileDocument | null | undefined): number {
  const value = document?.selectorSettings?.noInstrumentRetryMinutes;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN &&
    value <= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX
    ? value
    : DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES;
}

export function resolveSelectorRoleSettings(document: AiRoleProfileDocument | null | undefined): ResolvedSelectorRoleSettings {
  const settings = document?.selectorSettings;
  return {
    noInstrumentRetryMinutes: resolveSelectorNoInstrumentRetryMinutes(document),
    maxDiscoverySteps: resolveSelectorStepSetting(settings?.maxDiscoverySteps, DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS),
    maxVerificationSteps: resolveSelectorStepSetting(settings?.maxVerificationSteps, DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS),
    maxNoNewInfoSteps: resolveSelectorStepSetting(settings?.maxNoNewInfoSteps, DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS),
    maxRepeatedSymbolChecks: resolveSelectorStepSetting(
      settings?.maxRepeatedSymbolChecks,
      DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS,
    ),
    minCandidatesBeforeVerification: resolveSelectorMinCandidatesSetting(
      settings?.minCandidatesBeforeVerification,
      DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION,
    ),
    forceSubmitAfterStep: resolveSelectorStepSetting(settings?.forceSubmitAfterStep, DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP),
  };
}

export function renderAiRoleProfileMarkdown(
  document: AiRoleProfileDocument,
  options?: { maxAdditionalJsonChars?: number },
): string[] {
  const lines: string[] = [];

  if (document.objective?.trim()) {
    lines.push("## Objective", `- ${document.objective.trim()}`, "");
  }

  if (document.constraints.length > 0) {
    lines.push("## Constraints", ...document.constraints.map((item) => `- ${item}`), "");
  }

  const toolLines = renderToolPolicy(document.toolPolicy);
  if (toolLines.length > 0) {
    lines.push("## Tool policy", ...toolLines, "");
  }

  const methodLines = renderMethod(document.method);
  if (methodLines.length > 0) {
    lines.push(...methodLines, "");
  }

  const outputLines = renderOutput(document.output);
  if (outputLines.length > 0) {
    lines.push("## Output contract", ...outputLines, "");
  }

  const additional = buildAdditionalProfileJson(document);
  if (Object.keys(additional).length > 0) {
    lines.push(
      "## Additional profile JSON",
      "```json",
      truncate(JSON.stringify(additional, null, 2), options?.maxAdditionalJsonChars ?? 700),
      "```",
      "",
    );
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function renderToolPolicy(toolPolicy: AiRoleProfileDocument["toolPolicy"]): string[] {
  const lines: string[] = [];
  for (const [tool, policy] of Object.entries(toolPolicy)) {
    const bits: string[] = [];
    if (policy.mode) bits.push(policy.mode);
    if (policy.notes?.trim()) bits.push(policy.notes.trim());
    lines.push(bits.length > 0 ? `- ${tool}: ${bits.join(" — ")}` : `- ${tool}`);
  }
  return lines;
}

function renderMethod(method: AiRoleProfileDocument["method"]): string[] {
  const lines: string[] = [];
  if (method.checklist.length > 0) {
    lines.push("## Method checklist", ...method.checklist.map((item) => `- ${item}`));
  }
  if (method.requiredEvidence.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Required evidence", ...method.requiredEvidence.map((item) => `- ${item}`));
  }
  if (method.avoid.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Avoid", ...method.avoid.map((item) => `- ${item}`));
  }
  return lines;
}

function renderOutput(output: AiRoleProfileDocument["output"]): string[] {
  const lines: string[] = [];
  if (output.format) lines.push(`- Format: ${output.format}`);
  if (output.requiredSections.length > 0) {
    lines.push(`- Required sections: ${output.requiredSections.join(", ")}`);
  }
  if (output.minWords != null && output.maxWords != null) {
    lines.push(`- Target length: ${output.minWords}-${output.maxWords} words`);
  } else if (output.minWords != null) {
    lines.push(`- Minimum length: ${output.minWords} words`);
  } else if (output.maxWords != null) {
    lines.push(`- Maximum length: ${output.maxWords} words`);
  }
  if (output.terminalAction?.trim()) lines.push(`- Terminal action: ${output.terminalAction.trim()}`);
  return lines;
}

function buildAdditionalProfileJson(document: AiRoleProfileDocument): Record<string, unknown> {
  const additional: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (!["version", "objective", "constraints", "toolPolicy", "method", "output"].includes(key)) {
      additional[key] = value;
    }
  }

  const toolPolicyExtras: Record<string, unknown> = {};
  for (const [tool, policy] of Object.entries(document.toolPolicy)) {
    const rest = collectExtras(policy, ["mode", "notes"]);
    if (Object.keys(rest).length > 0) toolPolicyExtras[tool] = rest;
  }
  if (Object.keys(toolPolicyExtras).length > 0) additional.toolPolicy = toolPolicyExtras;

  const methodExtras = collectExtras(document.method, ["checklist", "requiredEvidence", "avoid"]);
  if (Object.keys(methodExtras).length > 0) additional.method = methodExtras;

  const outputExtras = collectExtras(document.output, ["format", "requiredSections", "minWords", "maxWords", "terminalAction"]);
  if (Object.keys(outputExtras).length > 0) additional.output = outputExtras;

  return additional;
}

function collectExtras(value: Record<string, unknown>, knownKeys: string[]): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!knownKeys.includes(key)) rest[key] = item;
  }
  return rest;
}

function cloneAiRoleProfileDocument(document: AiRoleProfileDocument): AiRoleProfileDocument {
  return JSON.parse(JSON.stringify(document)) as AiRoleProfileDocument;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function resolveSelectorStepSetting(value: number | undefined, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SELECTOR_STEP_SETTING_MIN &&
    value <= SELECTOR_STEP_SETTING_MAX
    ? value
    : fallback;
}

function resolveSelectorMinCandidatesSetting(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SELECTOR_STEP_SETTING_MAX
    ? value
    : fallback;
}
