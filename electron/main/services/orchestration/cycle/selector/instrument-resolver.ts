import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { buildSelectorDefinitionFingerprint, hashSelectorDefinition } from "../selector-definition-hash";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";
import { instrumentCacheTtlMs } from "../utils";
import { parseManualShortlist } from "./manual-shortlist";
import { buildSelectionInstructions } from "./selection-instructions";

export async function resolveInstruments(
  ctx: OrchestratorContext,
  session: WorkspaceSession,
  config: SessionConfig,
  cycleId?: string,
): Promise<ResolvedInstrument[]> {
  const activeCycleId = cycleId ?? crypto.randomUUID();
  const selectorSettings = ctx.deps.sessionSelectorSettingsRepo.get(session.id);
  const fingerprint = buildSelectorDefinitionFingerprint(session, ctx.deps);
  const definitionHash = hashSelectorDefinition(fingerprint);

  const cached = ctx.deps.instrumentCacheRepo.get(session.id);
  if (cached) {
    const expired = cached.expiresAt && new Date(cached.expiresAt) < new Date();
    if (expired) {
      ctx.deps.instrumentCacheRepo.clear(session.id);
    } else if (cached.definitionHash === definitionHash) {
      const parsed = JSON.parse(cached.instruments) as ResolvedInstrument[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new AppError("Cached instrument list is invalid or empty.", "VALIDATION_FAILED");
      }
      return parsed;
    }
  }

  if (session.selectionMode === "manual_shortlist" || !selectorSettings.aiPickerEnabled) {
    return parseManualShortlist(session, config);
  }

  ctx.emitEvent("INFO", null, "[stage:selector] starting discovery and verification workers", "orchestrator", activeCycleId);
  ctx.deps.bus.emit("research_phase_step", {
    sessionId: ctx.sessionId,
    phase: "selector",
    cycleId: activeCycleId,
    message: "[stage:selector] starting workers",
  });

  const selectionInstructions = await buildSelectionInstructions(ctx, session);
  const result = await ctx.deps.ai.runPhase<
    { selectionInstructions: string },
    import("@/lib/schemas").InstrumentSelection
  >("selector", session.id, { selectionInstructions }, activeCycleId);

  const sessionInstrumentClasses = ctx.getEffectiveInstrumentClasses(session);
  const filtered = result.output.instruments
    .filter((row) => sessionInstrumentClasses.includes(row.instrumentClass))
    .map(
      (row) =>
        ({
          symbol: row.symbol,
          instrumentClass: row.instrumentClass,
          instrumentDisplayName: row.instrumentDisplayName,
          predictionOutcome: row.predictionOutcome ?? null,
          instrumentMetadataJson: row.instrumentMetadataJson ?? null,
          selectorEvidence: row.selectorEvidence ?? null,
        }) satisfies ResolvedInstrument,
    );

  const payload: ResolvedInstrument[] = filtered.slice(0, config.max_concurrent_trades).map((row) => ({ ...row }));

  ctx.deps.agentRunsRepo.insert({
    ...result.run,
    session_id: ctx.sessionId,
    trade_id: null,
  });
  ctx.deps.agentMessagesRepo.insert({
    ...result.message,
    session_id: ctx.sessionId,
    trade_id: null,
  });

  if (payload.length === 0) {
    return [];
  }

  const cacheTtlMs = instrumentCacheTtlMs(ctx.deps.strategyContextService.get(ctx.sessionId).timeframe.holdingStyle);
  ctx.deps.instrumentCacheRepo.save({
    sessionId: session.id,
    instruments: JSON.stringify(payload),
    definitionHash,
    selectedAt: new Date().toISOString(),
    selectorAgentRunId: result.run.id,
    cycleId: activeCycleId,
    researchBriefsJson: JSON.stringify(
      Object.fromEntries(payload.map((row) => [row.symbol, row.selectorEvidence?.summary ?? ""])),
    ),
    researchGeneratedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + cacheTtlMs).toISOString(),
  });

  ctx.emitEvent("INFO", null, `[stage:selector] submission count=${payload.length}`, "orchestrator", activeCycleId);
  ctx.deps.bus.emit("research_phase_step", {
    sessionId: ctx.sessionId,
    phase: "selector",
    cycleId: activeCycleId,
    message: `Selector chose ${payload.length} instruments`,
  });

  return payload;
}
