import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument, SelectorCycleContext } from "../types";

export async function executeSelectorCycle(
  ctx: OrchestratorContext,
  context: SelectorCycleContext,
  onResolved: (instruments: ResolvedInstrument[], label: string) => void,
  getSessionConfig: () => SessionConfig,
  runResearchBurst: (session: WorkspaceSession, config: SessionConfig, cycleId: string) => Promise<ResolvedInstrument[]>,
): Promise<void> {
  if (!ctx.runtimeIsActive()) return;
  ctx.cycleContexts.set(context.cycleId, context);

  const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
  const config = getSessionConfig();
  ctx.queue.concurrency = config.max_concurrent_trades;
  ctx.deps.bus.emit("research_phase_started", { sessionId: ctx.sessionId, phase: "selector", cycleId: context.cycleId });

  const result = await ctx.getStepRunner(context.cycleId).run(
    "selector",
    () => runResearchBurst(session, config, context.cycleId),
    {
      onRetry: () => {
        if (!ctx.runtimeIsActive()) return;
        ctx.enqueueTask(
          () => executeSelectorCycle(ctx, context, onResolved, getSessionConfig, runResearchBurst),
          (error) => {
            ctx.emitEvent(
              "ERROR",
              null,
              `Scheduled selector retry failed: ${error instanceof Error ? error.message : String(error)}`,
              "orchestrator",
              context.cycleId,
            );
          },
        );
      },
    },
  );

  if (await ctx.pauseIfRequested(context.cycleId)) return;
  if (!result.ok) {
    ctx.handleStepFailure("selector", context.cycleId, result);
    ctx.deps.bus.emit("research_phase_failed", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId: context.cycleId,
      error: result.errorMessage,
    });
    return;
  }

  ctx.clearAttentionRequired();
  ctx.deps.bus.emit("research_phase_complete", {
    sessionId: ctx.sessionId,
    phase: "selector",
    cycleId: context.cycleId,
    instrumentCount: result.value.length,
  });
  onResolved(result.value, context.label);
}
