import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { tradeSignalSchema } from "@electron/shared/ai/trade-signals";
import { createLogger } from "../../../infra/log";
import { produceOptionsFlowSignal } from "../../../signals/options-flow-producer";
import {
  readDeterministicFactFromCtx,
  tradeSignalFromDeterministicFact,
} from "./deterministic-fact-consume";

const logger = createLogger("options-flow-input");

function syntheticDecisionRun(signal: TradeSignal): LLMRunResult<TradeSignal> {
  const runId = crypto.randomUUID();
  const run: AgentRun = {
    id: runId,
    session_id: "",
    trade_id: null,
    cycle_id: null,
    agent_type: "decision",
    model: "deterministic",
    provider_key: "rules",
    finish_reason: "stop",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    output_text: signal.reasoning,
    duration_ms: 0,
    created_at: new Date().toISOString(),
  };
  const message: AgentMessage = {
    id: crypto.randomUUID(),
    agent_run_id: runId,
    session_id: "",
    trade_id: null,
    cycle_id: null,
    role: "decision",
    provider_key: "rules",
    model_id: "deterministic",
    messages_json: "[]",
    thinking_json: null,
    tool_calls_json: "[]",
    output_json: JSON.stringify(signal),
    output_schema_name: "options-flow",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

function toTradeSignal(
  underlying: string,
  produced: ReturnType<typeof produceOptionsFlowSignal>,
  supportsMultileg: boolean,
): TradeSignal {
  if (produced.kind !== "setup") {
    return tradeSignalSchema.parse({
      symbol: underlying,
      action: "skip",
      executionStrategy: "options_flow",
      entryPrice: null,
      confidence: 0.2,
      reasoning: produced.reason,
    });
  }

  const { fact, spread, legs, contracts, maxDebitUsd, reason } = produced;
  const primarySymbol = supportsMultileg
    ? underlying
    : spread.longLeg.symbol;

  return tradeSignalSchema.parse({
    symbol: primarySymbol,
    action: fact.action,
    executionStrategy: "options_flow",
    entryPrice: Math.max(spread.netDebit, 0.01),
    confidence: fact.strength,
    strength: fact.strength,
    reasoning: reason,
    orderMetadata: {
      instrumentClass: "options",
      underlyingSymbol: underlying,
      structure: "vertical",
      longOcc: spread.longLeg.symbol,
      shortOcc: spread.shortLeg.symbol,
      legs,
      contracts,
      maxDebitUsd,
      netDebit: spread.netDebit,
      deterministicFact: fact,
      supportsMultileg,
    },
  });
}

/**
 * Chain → UOA → vertical → TradeSignal (Solution 10 Tracer A).
 * The engine is identity; this builder owns the composition.
 */
export const optionsFlowInputBuilder: EngineInputBuilder = {
  id: "options-flow-input",
  async build({ planCtx: ctx }) {
    const scheduledFact = readDeterministicFactFromCtx(ctx);
    if (scheduledFact) {
      return {
        task: tradeSignalFromDeterministicFact(scheduledFact, "options_flow"),
      };
    }

    const routeClass =
      ctx.instrument.instrumentClass === "options"
        ? "options"
        : ctx.instrument.instrumentClass;
    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      routeClass,
    );
    const underlying = ctx.instrument.symbol;
    const getOptionChain = adapter.getOptionChain?.bind(adapter);
    const chain = getOptionChain ? await getOptionChain(underlying) : [];

    if (chain.length === 0) {
      logger.warn(
        {
          sessionId: ctx.sessionId,
          cycleId: ctx.cycleId,
          symbol: underlying,
          brokerType: adapter.brokerType,
        },
        "options-flow received an empty option chain; cycle will skip.",
      );
    }

    const produced = produceOptionsFlowSignal({
      underlyingSymbol: underlying,
      chain,
      sessionInputGroupKey: ctx.sessionId,
    });
    const supportsMultileg = adapter.capabilities?.supportsMultileg === true;
    const signal = toTradeSignal(underlying, produced, supportsMultileg);

    return { task: signal };
  },
  applyOutput(state, output) {
    const signal = output as TradeSignal;
    return {
      ...state,
      decision: syntheticDecisionRun(signal),
    };
  },
};

export const OPTIONS_FLOW_INPUT_BUILDERS = [optionsFlowInputBuilder];
