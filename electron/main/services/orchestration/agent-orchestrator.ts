import PQueue from "p-queue";
import { toLegacySessionConfig, type EventSourceType, type InstrumentClass, type SessionConfig, type Trade, type WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { OrderRequest } from "../broker/adapters/broker-adapter";
import type { ApprovalRecheckInput, OrchestratorDeps } from "../session";
import { buildSelectorDefinitionFingerprint, hashSelectorDefinition } from "./selector-definition-hash";

type ResolvedInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

type AiResearchRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runAnalyst"]>>;
type AiReviewRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runReviewer"]>>;
type AiDecisionRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runDecisionMaker"]>>;

type DecisionOutput = {
  action: "trade" | "no_trade";
  instrumentSymbol?: string;
  instrumentDisplayName?: string;
  side?: "BUY" | "SELL";
  outcome?: "YES" | "NO";
  estimatedProb?: number;
  impliedProb?: number;
  edgePctPts?: number;
  instrumentMetadataJson?: string;
  sizeUsd?: number;
  confidence: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  reasoning: string;
};

export class AgentOrchestrator {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly approvalCallbacks = new Map<string, (approved: boolean) => void>();
  /** Trade id → approval id while waiting for human decision. */
  private readonly pendingApprovalIds = new Map<string, string>();
  private started = false;

  constructor(
    readonly sessionId: string,
    private readonly deps: OrchestratorDeps,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      this.queue.start();
      return;
    }

    const session = this.deps.sessionRepo.requireById(this.sessionId);
    const config = this.getSessionConfig();
    this.queue.concurrency = config.max_concurrent_trades;
    this.started = true;

    let instruments: ResolvedInstrument[];
    try {
      instruments = await this.resolveInstruments(session, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent("ERROR", null, `Instrument resolution failed: ${message}`);
      throw error instanceof AppError ? error : new AppError(message, "VALIDATION_FAILED");
    }

    for (const instrument of instruments) {
      this.queue.add(() => this.runTradeCycle(instrument)).catch((error) => {
        this.emitEvent(
          "ERROR",
          null,
          `Trade cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  async pause(): Promise<void> {
    this.queue.pause();
  }

  async resume(): Promise<void> {
    this.queue.start();
  }

  async stop(): Promise<void> {
    this.queue.clear();
    for (const approvalId of this.pendingApprovalIds.values()) {
      this.deps.capitalReservation.releaseByApproval(approvalId);
    }
    this.pendingApprovalIds.clear();
    for (const resolve of this.approvalCallbacks.values()) resolve(false);
    this.approvalCallbacks.clear();
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const approval = this.deps.tradeApprovalsRepo.require(input.approvalId);
    const trade = this.deps.tradesRepo.require(approval.tradeId);
    if (trade.status !== "pending") return;

    const config = this.getSessionConfig();
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      100000,
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const pipeline = await this.runAiPipeline(
      {
        symbol: trade.instrumentSymbol,
        instrumentClass: trade.instrumentType,
        instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
        predictionOutcome: trade.predictionOutcome ?? null,
        instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      },
      config,
    );
    if (!pipeline) return;

    const { technical, fundamental, review, decision } = pipeline;

    for (const result of [technical, fundamental, review, decision]) {
      this.deps.agentRunsRepo.insert({ ...result.run, session_id: this.sessionId, trade_id: trade.id });
      this.deps.agentMessagesRepo.insert({ ...result.message, session_id: this.sessionId, trade_id: trade.id });
    }

    const fresh = decision.output;
    if (fresh.action !== "trade") {
      this.failRecheck(trade.id, approval.id, "Fresh decision is no_trade; not placing order.");
      return;
    }

    const nextTrade = this.buildTradeFromDecision(
      trade.id,
      {
        symbol: trade.instrumentSymbol,
        instrumentClass: trade.instrumentType,
        instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
        predictionOutcome: trade.predictionOutcome ?? null,
        instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      },
      config,
      fresh,
    );
    this.deps.tradesRepo.patchPendingExecution(trade.id, {
      side: nextTrade.side,
      position_size_usd: nextTrade.position_size_usd,
      confidence_score: nextTrade.confidence_score,
      brokerAccountId: nextTrade.brokerAccountId,
    });
    const updated = this.deps.tradesRepo.require(trade.id);

    const risk = this.deps.riskEngine.validateDecision({
      config,
      stats,
        order: {
          instrumentSymbol: updated.instrumentSymbol,
          instrumentDisplayName: updated.instrumentDisplayName ?? null,
          predictionOutcome: updated.predictionOutcome ?? null,
          instrumentMetadataJson: updated.instrumentMetadataJson ?? null,
          instrumentType: input.instrumentClass,
          side: updated.side,
          sizeUsd: updated.position_size_usd,
      },
      confidence: updated.confidence_score ?? 0,
      maxExposureUsd:
        input.instrumentClass === "prediction_market"
          ? this.deps.strategyContextService.get(this.sessionId).riskConfig.maxExposureUsd
          : null,
    });

    if (!risk.allowed || !risk.value) {
      this.failRecheck(trade.id, approval.id, risk.reason ?? "Fresh risk check rejected the trade.");
      return;
    }

    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      const target = risk.value.sizeUsd;
      this.deps.capitalReservation.updateReservedAmountForApproval(approval.id, target);
    }

    const placed = await this.placeRoutedOrder(updated, input.instrumentClass, risk.value);
    if (!placed) {
      this.failRecheck(trade.id, approval.id, "Instrument conflict or broker routing blocked order placement.");
      return;
    }
    const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
    this.deps.capitalReservation.convertApprovalToOpenOrder(approval.id, trade.id);
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      this.deps.capitalReservation.convertOrderToPosition(trade.id);
    }
    this.emitEvent("INFO", trade.id, `Placed ${updated.side} ${updated.instrumentSymbol} $${updated.position_size_usd} via broker (post-approval recheck).`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private failRecheck(tradeId: string, approvalId: string, message: string): void {
    this.deps.capitalReservation.releaseByApproval(approvalId);
    const rejected = this.deps.tradesRepo.updateStatus(tradeId, "rejected", 0);
    this.emitEvent("WARN", tradeId, message);
    this.deps.bus.emit("trade_closed", rejected);
  }

  hasApprovalCallback(tradeId: string): boolean {
    return this.approvalCallbacks.has(tradeId);
  }

  resolveApproval(tradeId: string, approved: boolean): boolean {
    const resolve = this.approvalCallbacks.get(tradeId);
    if (!resolve) return false;

    this.approvalCallbacks.delete(tradeId);
    resolve(approved);
    return true;
  }

  private async runTradeCycle(instrument: ResolvedInstrument): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const config = this.getSessionConfig();
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      100000,
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const pipeline = await this.runAiPipeline(instrument, config);
    if (!pipeline) return;

    const { technical, fundamental, review, decision } = pipeline;

    const trade = this.createTradeFromDecision(instrument, config, decision.output);
    this.deps.tradesRepo.insert(trade);
    for (const result of [technical, fundamental, review, decision]) {
      this.deps.agentRunsRepo.insert({ ...result.run, session_id: this.sessionId, trade_id: trade.id });
      this.deps.agentMessagesRepo.insert({ ...result.message, session_id: this.sessionId, trade_id: trade.id });
    }

    if (decision.output.action !== "trade") return;

    const risk = this.deps.riskEngine.validateDecision({
      config,
      stats,
        order: {
          instrumentSymbol: trade.instrumentSymbol,
          instrumentDisplayName: trade.instrumentDisplayName ?? null,
          predictionOutcome: trade.predictionOutcome ?? null,
          instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
          instrumentType: instrument.instrumentClass,
          side: trade.side,
          sizeUsd: trade.position_size_usd,
        },
        confidence: trade.confidence_score ?? 0,
        maxExposureUsd:
          instrument.instrumentClass === "prediction_market"
            ? this.deps.strategyContextService.get(this.sessionId).riskConfig.maxExposureUsd
            : null,
      });
    if (!risk.allowed || !risk.value) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, risk.reason ?? "Trade rejected by risk engine");
      return;
    }

    let approvalIdForCapital: string | null = null;
    if (config.human_approval_required) {
      const { approved, approvalId } = await this.waitForApproval(trade, instrument.instrumentClass, decision.output, risk.reason);
      approvalIdForCapital = approvalId;
      if (!approved) {
        this.deps.capitalReservation.releaseByApproval(approvalId);
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected by user");
        this.deps.bus.emit("trade_closed", rejected);
        return;
      }
    }

    const placed = await this.placeRoutedOrder(trade, instrument.instrumentClass, risk.value);
    if (!placed) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, "Instrument conflict or broker routing blocked order placement.");
      this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
      return;
    }

    const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
    if (approvalIdForCapital) {
      this.deps.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
    }
    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool" && approvalIdForCapital) {
      this.deps.capitalReservation.convertOrderToPosition(trade.id);
    }
    this.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private async placeRoutedOrder(
    trade: Trade,
    instrumentClass: InstrumentClass,
    riskOrder: OrderRequest,
  ): Promise<{ brokerOrderId: string; filledAvgPrice: number } | null> {
    const { adapter, brokerAccountId } = await this.deps.brokerRouting.resolveAdapter(this.sessionId, instrumentClass);

    if (this.deps.tradesRepo.checkInstrumentConflict(brokerAccountId, trade.instrumentSymbol, this.sessionId)) {
      return null;
    }

    const wireSymbol = this.deps.instrumentNormalizer.toBrokerSymbol({
      symbol: trade.instrumentSymbol,
      instrumentClass,
      brokerType: adapter.brokerType,
    });

    const result = await adapter.placeOrder({
      instrumentSymbol: wireSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentType: instrumentClass,
      side: riskOrder.side,
      sizeUsd: riskOrder.sizeUsd,
    });

    if (trade.brokerAccountId !== brokerAccountId) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
    }

    return { brokerOrderId: result.brokerOrderId, filledAvgPrice: result.filledAvgPrice };
  }

  private async runAiPipeline(
    instrument: ResolvedInstrument,
    config: SessionConfig,
  ): Promise<{ technical: AiResearchRun; fundamental: AiResearchRun; review: AiReviewRun; decision: AiDecisionRun } | null> {
    const technical = await this.deps.ai.runAnalyst({ instrumentSymbol: instrument.symbol, context: instrument.instrumentDisplayName }, "technical", this.sessionId);
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const fundamental = await this.deps.ai.runAnalyst({ instrumentSymbol: instrument.symbol, context: instrument.instrumentDisplayName }, "fundamental", this.sessionId);
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const review = await this.deps.ai.runReviewer(
      {
        instrumentSymbol: instrument.symbol,
        technicalAnalysis: technical.output,
        fundamentalAnalysis: fundamental.output,
      },
      this.sessionId,
    );
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const decision = await this.deps.ai.runDecisionMaker(
      {
        instrumentSymbol: instrument.symbol,
        technicalAnalysis: technical.output,
        fundamentalAnalysis: fundamental.output,
        review: review.output,
        maxPositionUsd: config.max_position_usd,
      },
      this.sessionId,
    );
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    return { technical, fundamental, review, decision };
  }

  private waitForApproval(
    trade: Trade,
    instrumentClass: InstrumentClass,
    decisionOut: DecisionOutput,
    riskNote: string | undefined,
  ): Promise<{ approved: boolean; approvalId: string }> {
    const resolvedBroker = trade.brokerAccountId ?? this.resolveBrokerAccountId(instrumentClass);
    if (trade.brokerAccountId == null) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId: resolvedBroker });
    }

    const sessionStrategy = this.deps.strategyContextService.get(this.sessionId).timeframe;
    const approval = this.deps.tradeApprovalsRepo.createPending({
      sessionId: this.sessionId,
      tradeId: trade.id,
      brokerAccountId: resolvedBroker,
      instrumentSymbol: trade.instrumentSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentClass,
      proposedSide: trade.side,
      proposedSizeUsd: trade.position_size_usd,
      decisionSummaryJson: JSON.stringify({
        confidence: trade.confidence_score,
        reasoning: decisionOut.reasoning,
        riskNote: riskNote ?? null,
        sessionHorizon: {
          primaryTradingTimeframe: sessionStrategy.primaryTradingTimeframe,
          holdingStyle: sessionStrategy.holdingStyle,
          targetHoldDays: sessionStrategy.targetHoldDays,
          maxHoldDays: sessionStrategy.maxHoldDays,
          timeframeNotes: sessionStrategy.timeframeNotes.trim() || undefined,
        },
      }),
    });

    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      this.deps.capitalReservation.reserveForApproval({
        sessionId: this.sessionId,
        approvalId: approval.id,
        amountUsd: trade.position_size_usd,
      });
    }

    this.deps.bus.emit("approval_required", {
      trade_id: trade.id,
      approval_id: approval.id,
      session_id: this.sessionId,
      instrumentSymbol: trade.instrumentSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      side: trade.side,
      size_usd: trade.position_size_usd,
      confidence: trade.confidence_score ?? 0,
      reasoning: decisionOut.reasoning,
    });

    this.pendingApprovalIds.set(trade.id, approval.id);

    return new Promise((resolve) => {
      this.approvalCallbacks.set(trade.id, (approved) => {
        this.approvalCallbacks.delete(trade.id);
        this.pendingApprovalIds.delete(trade.id);
        resolve({ approved, approvalId: approval.id });
      });
    });
  }

  private resolveBrokerAccountId(instrumentClass: InstrumentClass): string {
    return this.deps.brokerRouting.resolveBrokerAccountId(this.sessionId, instrumentClass);
  }

  /** Fresh sizing for an existing pending trade after a recheck decision. */
  private buildTradeFromDecision(
    tradeId: string,
    instrument: ResolvedInstrument,
    config: SessionConfig,
    decision: DecisionOutput,
  ): Trade {
    const brokerAccountId = this.resolveBrokerAccountId(instrument.instrumentClass);
    const prediction = this.resolvePredictionTradeFields(instrument, decision);
    const positionSizeUsd = this.resolvePositionSizeUsd(instrument.instrumentClass, config, decision);
    return {
      id: tradeId,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: decision.instrumentSymbol ?? instrument.symbol,
      instrumentDisplayName: prediction.instrumentDisplayName,
      predictionOutcome: prediction.predictionOutcome,
      instrumentMetadataJson: prediction.instrumentMetadataJson,
      instrumentType: instrument.instrumentClass,
      side: decision.side ?? "BUY",
      entry_price: null,
      position_size_usd: positionSizeUsd,
      stop_loss_price: null,
      take_profit_price: null,
      strategy: config.strategy,
      status: "pending",
      opened_at: null,
      closed_at: null,
      final_pnl_usd: null,
      ai_cost_usd: 0,
      confidence_score: decision.confidence,
      broker_order_id: null,
      created_at: new Date().toISOString(),
    };
  }

  private createTradeFromDecision(
    instrument: ResolvedInstrument,
    config: SessionConfig,
    decision: DecisionOutput,
  ): Trade {
    const id = crypto.randomUUID();
    const brokerAccountId = this.resolveBrokerAccountId(instrument.instrumentClass);
    const isTrade = decision.action === "trade";
    const prediction = this.resolvePredictionTradeFields(instrument, decision);
    const positionSizeUsd = this.resolvePositionSizeUsd(instrument.instrumentClass, config, decision);
    return {
      id,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: decision.instrumentSymbol ?? instrument.symbol,
      instrumentDisplayName: prediction.instrumentDisplayName,
      predictionOutcome: prediction.predictionOutcome,
      instrumentMetadataJson: prediction.instrumentMetadataJson,
      instrumentType: instrument.instrumentClass,
      side: decision.side ?? "BUY",
      entry_price: null,
      position_size_usd: positionSizeUsd,
      stop_loss_price: null,
      take_profit_price: null,
      strategy: config.strategy,
      status: isTrade ? "pending" : "rejected",
      opened_at: null,
      closed_at: isTrade ? null : new Date().toISOString(),
      final_pnl_usd: isTrade ? null : 0,
      ai_cost_usd: 0,
      confidence_score: decision.confidence,
      broker_order_id: null,
      created_at: new Date().toISOString(),
    };
  }

  private emitAbort(): null {
    this.emitEvent("INFO", null, "Cycle aborted: session paused mid-flight.", "orchestrator");
    return null;
  }

  private emitEvent(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    tradeId: string | null,
    message: string,
    agentType: EventSourceType | null = null,
  ): void {
    const event = this.deps.eventsRepo.insert({
      session_id: this.sessionId,
      trade_id: tradeId,
      level,
      agent_type: agentType,
      message,
    });
    this.deps.bus.emit("agent_event", event);
  }

  private async resolveInstruments(
    session: WorkspaceSession,
    config: SessionConfig,
  ): Promise<ResolvedInstrument[]> {
    const selectorSettings = this.deps.sessionSelectorSettingsRepo.get(session.id);
    const fingerprint = buildSelectorDefinitionFingerprint(session, this.deps);
    const definitionHash = hashSelectorDefinition(fingerprint);

    const cached = this.deps.instrumentCacheRepo.get(session.id);
    if (cached?.definitionHash === definitionHash) {
      const parsed = JSON.parse(cached.instruments) as ResolvedInstrument[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new AppError("Cached instrument list is invalid or empty.", "VALIDATION_FAILED");
      }
      return parsed;
    }

    if (session.selectionMode === "manual_shortlist" || !selectorSettings.aiPickerEnabled) {
      return this.parseManualShortlist(session, config);
    }

    this.emitEvent("INFO", null, "Running instrument selector agent...");
    const result = await this.deps.ai.runInstrumentSelector(session.id, await this.buildSelectionInstructions(session));

    const filtered = result.output.instruments.filter((row: ResolvedInstrument) =>
      session.instrumentClasses.includes(row.instrumentClass),
    );
    if (filtered.length === 0) {
      throw new AppError(
        "Instrument selector returned no instruments compatible with this session's instrument classes.",
        "VALIDATION_FAILED",
      );
    }

    const limited = filtered.slice(0, config.max_concurrent_trades);
    const payload: ResolvedInstrument[] = limited.map((row: ResolvedInstrument) => ({
      symbol: row.symbol,
      instrumentClass: row.instrumentClass,
      instrumentDisplayName: row.instrumentDisplayName,
      predictionOutcome: row.predictionOutcome ?? null,
      instrumentMetadataJson: row.instrumentMetadataJson ?? null,
    }));

    this.deps.agentRunsRepo.insert({
      ...result.run,
      session_id: this.sessionId,
      trade_id: null,
    });
    this.deps.agentMessagesRepo.insert({
      ...result.message,
      session_id: this.sessionId,
      trade_id: null,
    });

    this.deps.instrumentCacheRepo.save({
      sessionId: session.id,
      instruments: JSON.stringify(payload),
      definitionHash,
      selectedAt: new Date().toISOString(),
      selectorAgentRunId: result.run.id,
    });

    this.emitEvent("INFO", null, `Instrument selector chose ${payload.length} instruments.`);
    return payload;
  }

  private parseManualShortlist(session: WorkspaceSession, config: SessionConfig): ResolvedInstrument[] {
    const symbols = session.instrumentScope
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const out: ResolvedInstrument[] = [];
    for (const line of symbols) {
      const parsed = this.parseManualInstrumentLine(line, session.instrumentClasses);
      const instrumentClass = parsed.instrumentClass;
      if (!session.instrumentClasses.includes(instrumentClass)) continue;
      out.push(parsed);
    }
    if (out.length === 0) {
      throw new AppError("Manual instrument shortlist is empty after parsing.", "VALIDATION_FAILED");
    }
    return out.slice(0, config.max_concurrent_trades);
  }

  private inferInstrumentClass(symbol: string, classes: InstrumentClass[]): InstrumentClass {
    if (classes.length === 1) return classes[0]!;
    const upper = symbol.toUpperCase();
    if (classes.includes("crypto") && upper.includes("-")) return "crypto";
    if (classes.includes("futures") && /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/i.test(upper)) return "futures";
    if (classes.includes("prediction_market") && symbol.startsWith("pm:")) return "prediction_market";
    if (classes.includes("stock")) return "stock";
    return classes[0]!;
  }

  private parseManualInstrumentLine(line: string, classes: InstrumentClass[]): ResolvedInstrument {
    if (line.startsWith("{")) {
      const parsed = JSON.parse(line) as ResolvedInstrument;
      return {
        symbol: parsed.symbol,
        instrumentClass: parsed.instrumentClass,
        instrumentDisplayName: parsed.instrumentDisplayName,
        predictionOutcome: parsed.predictionOutcome ?? null,
        instrumentMetadataJson: parsed.instrumentMetadataJson ?? null,
      };
    }
    const symbol = line.startsWith("pm:") ? line : line.toUpperCase();
    return {
      symbol,
      instrumentClass: this.inferInstrumentClass(symbol, classes),
    };
  }

  private getSessionConfig(): SessionConfig {
    return toLegacySessionConfig(this.deps.strategyContextService.get(this.sessionId));
  }

  private resolvePredictionTradeFields(
    instrument: ResolvedInstrument,
    decision: DecisionOutput,
  ): Pick<Trade, "instrumentDisplayName" | "predictionOutcome" | "instrumentMetadataJson"> {
    const instrumentDisplayName = decision.instrumentDisplayName ?? instrument.instrumentDisplayName ?? null;
    const predictionOutcome = decision.outcome ?? instrument.predictionOutcome ?? null;
    const instrumentMetadataJson =
      instrument.instrumentClass === "prediction_market"
        ? remapPredictionMetadataForOutcome(decision.instrumentMetadataJson ?? instrument.instrumentMetadataJson ?? null, predictionOutcome)
        : decision.instrumentMetadataJson ?? instrument.instrumentMetadataJson ?? null;

    return { instrumentDisplayName, predictionOutcome, instrumentMetadataJson };
  }

  private resolvePositionSizeUsd(
    instrumentClass: InstrumentClass,
    config: SessionConfig,
    decision: DecisionOutput,
  ): number {
    if (instrumentClass !== "prediction_market") {
      return Math.min(decision.sizeUsd ?? config.max_position_usd, config.max_position_usd);
    }

    const strategy = this.deps.strategyContextService.get(this.sessionId);
    const capitalBase = Math.min(
      this.deps.sessionRepo.requireById(this.sessionId).capitalLimitUsd,
      strategy.riskConfig.maxExposureUsd ?? Number.POSITIVE_INFINITY,
    );
    const explicit = decision.sizeUsd ?? null;
    const estimatedProb = decision.estimatedProb ?? null;
    const impliedProb = decision.impliedProb ?? null;

    if (explicit != null) {
      return Math.min(explicit, config.max_position_usd, strategy.riskConfig.maxExposureUsd ?? Number.POSITIVE_INFINITY);
    }

    if (estimatedProb == null || impliedProb == null || capitalBase <= 0) {
      return Math.min(config.max_position_usd, strategy.riskConfig.maxExposureUsd ?? config.max_position_usd);
    }

    const fullKelly = Math.max(0, (estimatedProb - impliedProb) / Math.max(1 - impliedProb, 0.01));
    const sized = capitalBase * strategy.riskConfig.kellyFraction * fullKelly;
    return Math.min(Math.max(sized, 0), config.max_position_usd, strategy.riskConfig.maxExposureUsd ?? Number.POSITIVE_INFINITY);
  }

  private async buildSelectionInstructions(session: WorkspaceSession): Promise<string> {
    if (!session.instrumentClasses.includes("prediction_market")) {
      return session.instrumentScope;
    }

    const candidates = await this.fetchPredictionMarketCandidates();
    if (candidates.length === 0) {
      return session.instrumentScope;
    }

    return `${session.instrumentScope}\n\nPrediction-market candidates (return only these canonical rows for prediction_market):\n${candidates
      .map((candidate) => `- ${JSON.stringify(candidate)}`)
      .join("\n")}`;
  }

  private async fetchPredictionMarketCandidates(): Promise<ResolvedInstrument[]> {
    const response = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=25");
    if (!response.ok) {
      this.emitEvent("WARN", null, `Polymarket candidate fetch failed: ${response.status}`);
      return [];
    }
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const out: Array<ResolvedInstrument & { score: number }> = [];

    for (const row of rows) {
      const conditionId = typeof row.conditionId === "string" ? row.conditionId : null;
      const question = typeof row.question === "string" ? row.question : null;
      const slug = typeof row.slug === "string" ? row.slug : null;
      const category = typeof row.category === "string" ? row.category : null;
      const resolutionTime = typeof row.endDate === "string" ? row.endDate : null;
      const liquidity = Number(row.liquidity ?? row.liquidityClob ?? row.volume ?? 0);
      const tokens = Array.isArray(row.tokens) ? row.tokens : [];
      if (!conditionId || !question || tokens.length === 0) continue;

      const yes = tokens.find((token) => token && typeof token === "object" && (token as { outcome?: unknown }).outcome === "Yes");
      const no = tokens.find((token) => token && typeof token === "object" && (token as { outcome?: unknown }).outcome === "No");
      const yesTokenId = typeof (yes as { token_id?: unknown } | undefined)?.token_id === "string" ? (yes as { token_id: string }).token_id : null;
      const noTokenId = typeof (no as { token_id?: unknown } | undefined)?.token_id === "string" ? (no as { token_id: string }).token_id : null;
      if (!yesTokenId || !noTokenId) continue;

      const timeScore = resolutionTime ? predictionResolutionScore(resolutionTime) : 0;
      const categoryScore = category ? 10 : 0;
      const score = Math.min(liquidity / 1000, 100) + timeScore + categoryScore;

      for (const [predictionOutcome, outcomeTokenId] of [["YES", yesTokenId], ["NO", noTokenId]] as const) {
        out.push({
          symbol: `pm:${conditionId}`,
          instrumentClass: "prediction_market",
          instrumentDisplayName: question,
          predictionOutcome,
          instrumentMetadataJson: JSON.stringify({
            slug,
            conditionId,
            outcomeTokenId,
            yesOutcomeTokenId: yesTokenId,
            noOutcomeTokenId: noTokenId,
            category,
            liquidity,
            resolutionTime,
          }),
          score,
        });
      }
    }

    return out
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ score: _score, ...instrument }) => instrument);
  }
}

function remapPredictionMetadataForOutcome(
  raw: string | null,
  predictionOutcome: "YES" | "NO" | null,
): string | null {
  if (!raw || !predictionOutcome) return raw;
  const parsed = JSON.parse(raw) as {
    yesOutcomeTokenId?: string;
    noOutcomeTokenId?: string;
    outcomeTokenId?: string;
  };
  const outcomeTokenId = predictionOutcome === "YES" ? parsed.yesOutcomeTokenId : parsed.noOutcomeTokenId;
  return JSON.stringify({ ...parsed, outcomeTokenId: outcomeTokenId ?? parsed.outcomeTokenId });
}

function predictionResolutionScore(resolutionTime: string): number {
  const ms = new Date(resolutionTime).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 30;
  if (days <= 7) return 20;
  if (days <= 30) return 10;
  return 4;
}
