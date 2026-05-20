import type { ExecutionStage, SessionConfig } from "@/lib/types";
import type { ApprovalRecheckInput, OrchestratorDeps } from "../../session";
import { OrchestratorContext } from "./orchestrator-context";
import { runPhaseCycle } from "./orchestrator-step";
import { handleResolvedInstruments } from "./scheduling/instrument-queue";
import {
  attachTradeClosedListener,
  detachTradeClosedListener,
} from "./scheduling/trade-closed-handler";
import { runSelector } from "./selector/run-selector";
import { hasApprovalCallback, resolveApproval } from "./trade/approval-flow";
import { runApprovalRecheck } from "./trade/approval-recheck";
import { executeTradeCycle, runTradeCycle } from "./trade/trade-cycle";
import type { ResolvedInstrument, SelectorCycleContext } from "./types";

export type { ResolvedInstrument } from "./types";

export class AgentOrchestrator {
  private readonly ctx: OrchestratorContext;

  constructor(
    readonly sessionId: string,
    private readonly deps: OrchestratorDeps,
  ) {
    this.ctx = new OrchestratorContext(sessionId, deps);
  }

  async start(): Promise<void> {
    if (this.ctx.started) {
      this.deps.logger.debug(
        { sessionId: this.sessionId },
        "orchestrator already started; resuming queue",
      );
      this.ctx.queue.start();
      return;
    }

    const config = this.getSessionConfig();
    this.ctx.queue.concurrency = config.max_concurrent_trades;
    this.deps.logger.info(
      { sessionId: this.sessionId, concurrency: this.ctx.queue.concurrency },
      "orchestrator starting",
    );
    attachTradeClosedListener(this.ctx, () =>
      this.scheduleSelectorCycle("Trade-closed research cycle complete"),
    );
    this.ctx.started = true;
    this.ctx.enqueueTask(
      () =>
        this.executeSelectorCycle({
          kind: "selector",
          cycleId: crypto.randomUUID(),
          label: "Initial research cycle complete",
        }),
      (error) => {
        this.ctx.emitEvent(
          "ERROR",
          null,
          `Initial selector cycle failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
        );
      },
    );
    this.deps.logger.info(
      { sessionId: this.sessionId },
      "orchestrator started",
    );
  }

  async pause(): Promise<void> {
    this.ctx.queue.pause();
    this.ctx.clearNoInstrumentRetry();
  }

  async resume(): Promise<void> {
    this.ctx.pauseAfterStep = false;
    if (!this.ctx.started) {
      await this.start();
      return;
    }
    this.ctx.queue.start();
  }

  async restartFromAttention(): Promise<void> {
    this.ctx.pauseAfterStep = false;
    this.ctx.clearNoInstrumentRetry();
    this.ctx.queue.start();
    if (!this.ctx.started) {
      await this.start();
      return;
    }
    const cycleId = crypto.randomUUID();
    this.deps.logger.info(
      { sessionId: this.sessionId, cycleId },
      "orchestrator restart from attention_required",
    );
    this.ctx.enqueueTask(
      () =>
        this.executeSelectorCycle({
          kind: "selector",
          cycleId,
          label: "Selector cycle restarted after attention",
        }),
      (error) => {
        this.ctx.emitEvent(
          "ERROR",
          null,
          `Restart selector cycle failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
          cycleId,
        );
      },
    );
  }

  async stop(): Promise<void> {
    this.deps.logger.info(
      {
        sessionId: this.sessionId,
        pendingApprovals: this.ctx.pendingApprovalIds.size,
        queuedApprovals: this.ctx.approvalCallbacks.size,
      },
      "orchestrator stopping",
    );
    this.ctx.queue.clear();
    detachTradeClosedListener(this.ctx);
    this.ctx.clearNoInstrumentRetry();
    this.ctx.cycleRestartInFlight = false;
    this.ctx.pauseAfterStep = false;
    this.ctx.disposeStepRunners();
    this.ctx.cycleContexts.clear();
    this.ctx.releaseApprovalsAndCapital();
    this.deps.logger.info(
      { sessionId: this.sessionId },
      "orchestrator stopped",
    );
  }

  pauseAfterCurrentStep(): void {
    this.ctx.pauseAfterStep = true;
  }

  async retryStep(
    cycleId: string,
    stage: ExecutionStage,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const context = this.ctx.cycleContexts.get(cycleId);
    if (!context) {
      return {
        ok: false,
        reason: `No live cycle context exists for ${cycleId}.`,
      };
    }

    this.deps.sessionExecutionStepsRepo.clearFailed(
      this.sessionId,
      cycleId,
      stage,
    );
    const runner = this.ctx.stepRunners.get(cycleId);
    if (runner?.get(stage)?.status === "retrying") {
      runner.dispose();
      this.ctx.stepRunners.delete(cycleId);
    }

    const enqueue =
      context.kind === "selector"
        ? () => this.executeSelectorCycle(context)
        : () => executeTradeCycle(this.ctx, context);

    this.ctx.enqueueTask(enqueue, (error) => {
      this.ctx.emitEvent(
        "ERROR",
        null,
        `Step retry failed: ${error instanceof Error ? error.message : String(error)}`,
        "orchestrator",
        cycleId,
      );
    });
    return { ok: true };
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    return runApprovalRecheck(this.ctx, input);
  }

  hasApprovalCallback(tradeId: string): boolean {
    return hasApprovalCallback(this.ctx, tradeId);
  }

  resolveApproval(tradeId: string, approved: boolean): boolean {
    return resolveApproval(this.ctx, tradeId, approved);
  }

  /** Used by trade scheduling. */
  runTradeCycle(instrument: ResolvedInstrument): Promise<void> {
    return runTradeCycle(this.ctx, instrument);
  }

  private async executeSelectorCycle(
    context: SelectorCycleContext,
  ): Promise<void> {
    return runPhaseCycle(this.ctx, {
      context,
      stage: "selector",
      prepare: () => {
        this.ctx.queue.concurrency =
          this.getSessionConfig().max_concurrent_trades;
      },
      run: () => {
        const session = this.ctx.deps.sessionRepo.requireById(this.sessionId);
        return runSelector(
          this.ctx,
          session,
          this.getSessionConfig(),
          context.cycleId,
        );
      },
      retryCycle: () => this.executeSelectorCycle(context),
      retryErrorLabel: "Scheduled selector retry failed",
      busEvents: { phase: "selector" },
      completePayload: (instruments) => ({
        instrumentCount: instruments.length,
      }),
      onSuccess: (instruments) =>
        this.handleResolvedInstruments(instruments, context.label),
    });
  }

  private scheduleSelectorCycle(label: string): Promise<void> {
    return this.executeSelectorCycle({
      kind: "selector",
      cycleId: crypto.randomUUID(),
      label,
    });
  }

  private handleResolvedInstruments(
    instruments: ResolvedInstrument[],
    context: string,
  ): void {
    handleResolvedInstruments(this.ctx, instruments, context, {
      scheduleSelectorCycle: () =>
        this.scheduleSelectorCycle("Scheduled selector retry complete"),
      enqueueTradeCycle: (instrument) => runTradeCycle(this.ctx, instrument),
    });
  }

  /** @internal Visible to orchestrator unit tests. */
  private getSessionConfig(): SessionConfig {
    return this.ctx.getSessionConfig();
  }
}
