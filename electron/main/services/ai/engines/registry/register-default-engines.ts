import { z } from "zod";
import type { BrokerAllocationGate } from "../../../risk/broker-allocation-gate";
import type { ExitPolicyEvaluator } from "../../../risk/exit-policy-evaluator";
import type { RiskEngine } from "../../../risk/risk-engine";
import type { CandidateValidationService } from "../../../orchestration/policy/candidate-validation-service";
import type { OrderPolicyGate } from "../../../orchestration/policy/order-policy-gate";
import { registerEngine } from "./engine-registry";
import { registerPipelineEngines } from "./register-pipeline-engines";

export function registerDefaultEngines(services: {
  riskEngine: RiskEngine;
  candidateValidation: CandidateValidationService;
  orderPolicyGate: OrderPolicyGate;
  brokerAllocationGate: BrokerAllocationGate;
  exitPolicyEvaluator: ExitPolicyEvaluator;
}): void {
  registerPipelineEngines();

  registerEngine({
    id: "risk-summary",
    kind: "context",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (_input, ctx) => ({
      maxPositionUsd: ctx.strategyContext.riskConfig.maxPositionUsd,
      maxExposureUsd: ctx.strategyContext.riskConfig.maxExposureUsd,
      waitForOpenThreshold: ctx.strategyContext.riskConfig.waitForOpenThreshold,
      holdingStyle: ctx.strategyContext.timeframe.holdingStyle,
      sideBias: ctx.strategyContext.rules.sideBias,
    }),
  });

  registerEngine({
    id: "candidate-validator",
    kind: "validator",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => services.candidateValidation.validate(input as Parameters<CandidateValidationService["validate"]>[0]),
  });

  registerEngine({
    id: "order-policy",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => services.orderPolicyGate.evaluate(input as Parameters<OrderPolicyGate["evaluate"]>[0]),
  });

  registerEngine({
    id: "broker-allocation",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { brokerAccountId: string; sessionId: string; sizeUsd: number; symbol?: string }) => ({
      allocation: services.brokerAllocationGate.checkOrderFits(input.brokerAccountId, input.sessionId, input.sizeUsd),
      conflict: input.symbol
        ? services.brokerAllocationGate.checkInstrumentConflict(input.brokerAccountId, input.symbol, input.sessionId)
        : { ok: true },
    }),
  });

  registerEngine({
    id: "exit-policy",
    kind: "lifecycle",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => services.exitPolicyEvaluator.evaluate(input as Parameters<ExitPolicyEvaluator["evaluate"]>[0]),
  });

  registerEngine({
    id: "risk-gate",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => services.riskEngine.validateDecision(input as Parameters<RiskEngine["validateDecision"]>[0]),
  });
}
