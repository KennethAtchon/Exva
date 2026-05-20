import type { InstrumentSelection } from "@/lib/schemas";
import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { MarketHoursService } from "../market-hours-service";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";

const marketHours = new MarketHoursService();

export async function runSelector(
  ctx: OrchestratorContext,
  session: WorkspaceSession,
  config: SessionConfig,
  cycleId: string,
): Promise<ResolvedInstrument[]> {
  const result = (await ctx.deps.ai.runPlan("selector", {
    sessionId: session.id,
    cycleId,
    input: {},
  })) as import("../../../ai/pipeline-runtime/plan/phase/types").PhasePlanRunResult<InstrumentSelection>;

  if (result.source === "ai_picker") {
    ctx.emitEvent(
      "INFO",
      null,
      "[stage:selector] starting discovery and verification workers",
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: "[stage:selector] starting workers",
    });
  }

  const instruments: ResolvedInstrument[] = result.output.instruments.map(
    (row) => ({
      symbol: row.symbol,
      instrumentClass: row.instrumentClass,
      instrumentDisplayName: row.instrumentDisplayName,
      predictionOutcome: row.predictionOutcome ?? null,
      instrumentMetadataJson: row.instrumentMetadataJson ?? null,
      selectorEvidence: row.selectorEvidence ?? null,
    }),
  );

  if (result.source === "ai_picker" && instruments.length > 0) {
    ctx.emitEvent(
      "INFO",
      null,
      `[stage:selector] submission count=${instruments.length}`,
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: `Selector chose ${instruments.length} instruments`,
    });
  }

  const diagnostics = result.output.diagnostics;
  if (
    result.source === "ai_picker" &&
    instruments.length === 0 &&
    diagnostics &&
    diagnostics.rejected.length > 0
  ) {
    const summary = diagnostics.rejected
      .slice(0, 5)
      .map((row) => `${row.symbol}: ${row.reasons[0] ?? "rejected"}`)
      .join("; ");
    ctx.emitEvent(
      "WARN",
      null,
      `[stage:selector] no instruments accepted; ${diagnostics.rejected.length} rejected (${summary})`,
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: `Selector rejected all candidates: ${summary}`,
    });
  }

  return marketHours.filterTradable(
    instruments.slice(0, config.max_concurrent_trades),
  );
}
