import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";

export async function resolveInstruments(
  ctx: OrchestratorContext,
  session: WorkspaceSession,
  config: SessionConfig,
  cycleId?: string,
): Promise<ResolvedInstrument[]> {
  const activeCycleId = cycleId ?? crypto.randomUUID();
  const result = await ctx.deps.ai.runPhasePlan<import("@/lib/schemas").InstrumentSelection>(
    "selector",
    session.id,
    activeCycleId,
  );

  if (result.source === "ai_picker") {
    ctx.emitEvent("INFO", null, "[stage:selector] starting discovery and verification workers", "orchestrator", activeCycleId);
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId: activeCycleId,
      message: "[stage:selector] starting workers",
    });
  }

  const payload = result.output.instruments.map(
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

  if (result.source === "ai_picker" && payload.length > 0) {
    ctx.emitEvent("INFO", null, `[stage:selector] submission count=${payload.length}`, "orchestrator", activeCycleId);
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId: activeCycleId,
      message: `Selector chose ${payload.length} instruments`,
    });
  }

  return payload.slice(0, config.max_concurrent_trades);
}
