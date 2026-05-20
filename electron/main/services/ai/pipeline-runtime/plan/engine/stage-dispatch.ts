import { AppError } from "@electron/shared/infra/errors";
import { runEngineBinding } from "../../execution/engine-context-runner";
import type { EngineStageConfig } from "./input-builder-registry";
import { getEngineInputBuilder } from "./input-builder-registry";
import type { CyclePlanRunContext, TradeCyclePlanState } from "../cycle/types";

export async function runEngineStage(
  config: EngineStageConfig,
  ctx: CyclePlanRunContext,
  state: TradeCyclePlanState,
): Promise<TradeCyclePlanState> {
  const built = await Promise.resolve(getEngineInputBuilder(config.inputBuilderId).build({ planCtx: ctx, state }));
  const output = runEngineBinding({
    phase: config.bindingPhase,
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: config.engineId, kind: config.engineKind, mode: "read" },
    task: built.task as Record<string, unknown>,
  });
  const patched = built.statePatch ? { ...state, ...built.statePatch } : state;
  return applyEngineOutput(config.engineId, patched, output);
}

export async function runEngineChainStage(
  engines: EngineStageConfig[],
  ctx: CyclePlanRunContext,
  state: TradeCyclePlanState,
): Promise<TradeCyclePlanState> {
  let current = state;
  for (const engine of engines) {
    current = await runEngineStage(engine, ctx, current);
  }
  return current;
}

function applyEngineOutput(engineId: string, state: TradeCyclePlanState, output: unknown): TradeCyclePlanState {
  switch (engineId) {
    case "candidate-validator": {
      const validation = output as { allowed: boolean; reasons: string[] };
      if (!validation.allowed) {
        throw new AppError(`Candidate validation failed: ${validation.reasons.join("; ")}`, "VALIDATION_FAILED");
      }
      return state;
    }
    case "execution-profile-engine":
      return { ...state, executionProfile: output as TradeCyclePlanState["executionProfile"] };
    case "risk-gate": {
      const risk = output as { allowed: boolean; reason?: string; value?: TradeCyclePlanState["riskOrder"] };
      if (!risk.allowed || !risk.value) {
        throw new AppError(risk.reason ?? "Trade rejected by risk engine", "VALIDATION_FAILED");
      }
      return { ...state, riskOrder: risk.value };
    }
    case "broker-allocation": {
      const brokerAllocation = output as TradeCyclePlanState["brokerAllocation"];
      const brokerAccountId = (output as { brokerAccountId?: string }).brokerAccountId;
      if (!brokerAllocation?.allocation.ok) {
        throw new AppError(brokerAllocation?.allocation.reason ?? "Broker allocation rejected order", "VALIDATION_FAILED");
      }
      if (!brokerAllocation.conflict.ok) {
        throw new AppError(brokerAllocation.conflict.reason ?? "Instrument conflict blocked order", "VALIDATION_FAILED");
      }
      return { ...state, brokerAllocation, brokerAccountId: brokerAccountId ?? state.brokerAccountId };
    }
    default:
      return state;
  }
}
