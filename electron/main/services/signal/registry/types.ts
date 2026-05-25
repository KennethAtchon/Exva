import { z } from "zod";
import type {
  PipelinePhase,
  EngineId,
  EngineKind,
} from "@electron/shared/ai/ai-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { RiskEngine } from "../../risk/risk-engine";
import type { CandidateValidationService } from "../../orchestration/policy/candidate-validation-service";
import type { OrderPolicyGate } from "../../orchestration/policy/order-policy-gate";
import type { BrokerAllocationGate } from "../../risk/broker-allocation-gate";
import type { ExitPolicyEvaluator } from "../../risk/exit-policy-evaluator";

export interface SignalEngineContext {
  sessionId: string;
  phase: PipelinePhase;
  cycleId: string | null;
  strategyContext: SessionStrategyContext;
  services?: {
    riskEngine?: RiskEngine;
    candidateValidation?: CandidateValidationService;
    orderPolicyGate?: OrderPolicyGate;
    brokerAllocationGate?: BrokerAllocationGate;
    exitPolicyEvaluator?: ExitPolicyEvaluator;
  };
}

interface SignalEngineDefinition<TInput = unknown, TOutput = unknown> {
  id: EngineId;
  kind: EngineKind;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  run(input: TInput, ctx: SignalEngineContext): Promise<TOutput> | TOutput;
}

export type AnySignalEngine = SignalEngineDefinition<unknown, unknown>;
