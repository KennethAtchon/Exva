import { createHash } from "node:crypto";
import type { InstrumentClass, PromptSource, SelectionMode, WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps } from "../session/session-types";

export type SelectorDefinitionFingerprint = {
  selectionMode: SelectionMode;
  aiPickerEnabled: boolean;
  instrumentScope: string;
  instrumentClasses: InstrumentClass[];
  searchProviderId: string | null;
  selectorRole: {
    providerKey: string;
    modelId: string;
    promptSource: PromptSource;
    promptMarkdown: string;
    webSearchEnabled: boolean;
  };
  routingSnapshot: Array<{
    instrumentClass: InstrumentClass;
    brokerAccountId: string | null;
  }>;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function routingSnapshot(
  sessionId: string,
  instrumentClasses: InstrumentClass[],
  brokerRouting: OrchestratorDeps["brokerRouting"],
): SelectorDefinitionFingerprint["routingSnapshot"] {
  const unique = [...new Set(instrumentClasses)].sort((a, b) => a.localeCompare(b));
  return unique.map((instrumentClass) => {
    try {
      return {
        instrumentClass,
        brokerAccountId: brokerRouting.resolveBrokerAccountId(sessionId, instrumentClass),
      };
    } catch {
      return { instrumentClass, brokerAccountId: null };
    }
  });
}

export function buildSelectorDefinitionFingerprint(
  session: WorkspaceSession,
  deps: Pick<
    OrchestratorDeps,
    "sessionSelectorSettingsRepo" | "sessionAiRolesRepo" | "workspacePreferencesRepo" | "brokerRouting"
  >,
): SelectorDefinitionFingerprint {
  const selectorSettings = deps.sessionSelectorSettingsRepo.get(session.id);
  const role = deps.sessionAiRolesRepo.getByRole(session.id, "instrument_selector");
  const prefs = deps.workspacePreferencesRepo.get();
  const searchProviderId = session.defaultSearchProviderId ?? prefs.defaultSearchProviderId ?? null;

  return {
    selectionMode: session.selectionMode,
    aiPickerEnabled: selectorSettings.aiPickerEnabled,
    instrumentScope: session.instrumentScope,
    instrumentClasses: [...session.instrumentClasses].sort((a, b) => a.localeCompare(b)),
    searchProviderId,
    selectorRole: role
      ? {
          providerKey: role.providerKey,
          modelId: role.modelId,
          promptSource: role.promptSource,
          promptMarkdown: role.promptMarkdown,
          webSearchEnabled: role.webSearchEnabled,
        }
      : {
          providerKey: "",
          modelId: "",
          promptSource: "default" as PromptSource,
          promptMarkdown: "",
          webSearchEnabled: false,
        },
    routingSnapshot: routingSnapshot(session.id, session.instrumentClasses, deps.brokerRouting),
  };
}

export function hashSelectorDefinition(fp: SelectorDefinitionFingerprint): string {
  return createHash("sha256").update(stableStringify(fp)).digest("hex");
}
