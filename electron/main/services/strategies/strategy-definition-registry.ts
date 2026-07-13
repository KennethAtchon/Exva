import { z } from "zod";
import type { InstrumentClass, TradingTimeframe } from "@electron/shared/domain/enums";
import type { DeterministicStrategy } from "../backtest/replay-engine";

export interface StrategyDefinition<TParameters = Record<string, unknown>> {
  id: string;
  parameterSchemaVersion: number;
  /** Input may include defaults (ZodDefault); output is TParameters. */
  parameterSchema: z.ZodType<TParameters, z.ZodTypeDef, unknown>;
  acceptedInstrumentClasses: readonly InstrumentClass[];
  supportedTimeframes: readonly TradingTimeframe[];
  minimumCadenceMs: number;
  requiredBarCount: number;
  implementationStatus: "available" | "disabled";
  implementationVersion: number;
  create(parameters: TParameters): DeterministicStrategy;
}

export class StrategyDefinitionRegistry {
  private readonly definitions = new Map<string, StrategyDefinition<unknown>>();

  register<TParameters>(definition: StrategyDefinition<TParameters>): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Strategy definition already registered: "${definition.id}"`);
    }
    this.definitions.set(
      definition.id,
      definition as StrategyDefinition<unknown>,
    );
  }

  get(id: string): StrategyDefinition<unknown> | null {
    return this.definitions.get(id) ?? null;
  }

  /**
   * Like get(), but throws if the definition is unknown or disabled.
   * Use for activation paths that must hard-fail on misconfiguration.
   */
  require(id: string): StrategyDefinition<unknown> {
    const def = this.definitions.get(id);
    if (!def) {
      throw new Error(`Strategy definition not found: "${id}"`);
    }
    if (def.implementationStatus === "disabled") {
      throw new Error(
        `Strategy "${id}" is disabled and cannot be activated`,
      );
    }
    return def;
  }

  list(): StrategyDefinition<unknown>[] {
    return Array.from(this.definitions.values());
  }

  validateParameters(
    id: string,
    params: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: z.ZodError } {
    const def = this.definitions.get(id);
    if (!def) {
      throw new Error(`Strategy definition not found: "${id}"`);
    }
    const result = def.parameterSchema.safeParse(params);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  }
}
