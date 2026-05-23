import { createHash } from "node:crypto";
import type {
  InstrumentClass,
  PromptSource,
  SelectionMode,
  WorkspaceSession,
} from "@/lib/types";
import type { InstrumentSelection } from "@/lib/schemas";
import type { PhasePlanServices } from "../../phases/services";
import type { CachePolicy } from "../registry/cache-policy-registry";
import type { PhasePlanRunContext } from "../../phases/types";
import { resolveSessionInstrumentClasses } from "../../../session/effective-instrument-classes";

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
  brokerRouting: PhasePlanServices["brokerRouting"],
): SelectorDefinitionFingerprint["routingSnapshot"] {
  const unique = [...new Set(instrumentClasses)].sort((a, b) =>
    a.localeCompare(b),
  );
  return unique.map((instrumentClass) => {
    try {
      return {
        instrumentClass,
        brokerAccountId: brokerRouting.resolveBrokerAccountId(
          sessionId,
          instrumentClass,
        ),
      };
    } catch {
      return { instrumentClass, brokerAccountId: null };
    }
  });
}

export function buildSelectorDefinitionFingerprint(
  session: WorkspaceSession,
  services: Pick<
    PhasePlanServices,
    | "sessionSelectorSettingsRepo"
    | "sessionAiPhasesRepo"
    | "workspacePreferencesRepo"
    | "brokerRouting"
    | "sessionBrokerAssignmentsRepo"
    | "brokerAccountsRepo"
  >,
): SelectorDefinitionFingerprint {
  const selectorSettings = services.sessionSelectorSettingsRepo.get(session.id);
  const selectorPhase = services.sessionAiPhasesRepo.getByPhase(
    session.id,
    "selector",
  );
  const prefs = services.workspacePreferencesRepo.get();
  const searchProviderId =
    session.defaultSearchProviderId ?? prefs.defaultSearchProviderId ?? null;
  const instrumentClasses = resolveSessionInstrumentClasses(session, services);

  return {
    selectionMode: session.selectionMode,
    aiPickerEnabled: selectorSettings.aiPickerEnabled,
    instrumentScope: session.instrumentScope,
    instrumentClasses,
    searchProviderId,
    selectorRole: selectorPhase
      ? {
          providerKey: selectorPhase.providerKey,
          modelId: selectorPhase.modelId,
          promptSource: selectorPhase.promptSource as PromptSource,
          promptMarkdown: selectorPhase.promptMarkdown,
        }
      : {
          providerKey: "",
          modelId: "",
          promptSource: "default" as PromptSource,
          promptMarkdown: "",
        },
    routingSnapshot: routingSnapshot(
      session.id,
      instrumentClasses,
      services.brokerRouting,
    ),
  };
}

export function hashSelectorDefinition(
  fp: SelectorDefinitionFingerprint,
): string {
  return createHash("sha256").update(stableStringify(fp)).digest("hex");
}

export function selectorDefinitionFingerprint(
  session: WorkspaceSession,
  services: PhasePlanServices,
): string {
  return hashSelectorDefinition(
    buildSelectorDefinitionFingerprint(session, services),
  );
}

function cacheTtlMs(holdingStyle: string): number {
  switch (holdingStyle) {
    case "intraday_flat":
      return 30 * 60 * 1000;
    case "multi_day_swing":
      return 4 * 60 * 60 * 1000;
    case "weeks_position":
      return 24 * 60 * 60 * 1000;
    default:
      return 4 * 60 * 60 * 1000;
  }
}

export const SELECTOR_INSTRUMENT_CACHE_POLICY: CachePolicy<InstrumentSelection> =
  {
    id: "selector-instrument-cache",
    fingerprint(ctx: PhasePlanRunContext) {
      return selectorDefinitionFingerprint(ctx.session, ctx.services);
    },
    read(ctx: PhasePlanRunContext, fingerprint: string) {
      const cached = ctx.services.instrumentCacheRepo.get(ctx.sessionId);
      if (!cached) return null;
      const expired =
        cached.expiresAt && new Date(cached.expiresAt) < new Date();
      if (expired) {
        ctx.services.instrumentCacheRepo.clear(ctx.sessionId);
        return null;
      }
      if (cached.definitionHash !== fingerprint) return null;
      const parsed = JSON.parse(cached.instruments) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return { instruments: parsed };
    },
    write(
      ctx: PhasePlanRunContext,
      fingerprint: string,
      output: InstrumentSelection,
      meta: { agentRunId: string; cycleId: string },
    ) {
      const holdingStyle = ctx.services.strategyContextService.get(
        ctx.sessionId,
      ).timeframe.holdingStyle;
      ctx.services.instrumentCacheRepo.save({
        sessionId: ctx.sessionId,
        instruments: JSON.stringify(output.instruments),
        definitionHash: fingerprint,
        selectedAt: new Date().toISOString(),
        selectorAgentRunId: meta.agentRunId,
        cycleId: meta.cycleId,
        researchBriefsJson: JSON.stringify(
          Object.fromEntries(
            output.instruments.map((row) => [
              row.symbol,
              row.selectorEvidence?.summary ?? "",
            ]),
          ),
        ),
        researchGeneratedAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + cacheTtlMs(holdingStyle),
        ).toISOString(),
      });
    },
  } satisfies CachePolicy<InstrumentSelection>;
