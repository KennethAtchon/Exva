import { z } from "zod";
import type { LiveSignalSourceType } from "@electron/shared/domain/signals";
import type { MarketSignal } from "@electron/shared/domain/market-signal";
import { CikTickerCache } from "../cache/cik-ticker-cache";
import { EdgarSignalSource } from "../sources/edgar-signal-source";
import { MockSignalSource } from "../sources/mock-signal-source";
import { PredictionEventSignalSource } from "../sources/prediction-event-signal-source";
import type { ISignalSource } from "../ISignalSource";

export interface SourceAdapterDefinition<TConfig = Record<string, unknown>> {
  kind: LiveSignalSourceType;
  configSchemaVersion: number;
  configSchema: z.ZodType<TConfig>;
  outputContractId: string;
  create(input: {
    definition: { id: string; config: Record<string, unknown>; configJson?: string };
    emit: (signals: MarketSignal[]) => Promise<void>;
  }): ISignalSource;
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<
    LiveSignalSourceType,
    SourceAdapterDefinition<unknown>
  >();

  register<TConfig>(definition: SourceAdapterDefinition<TConfig>): void {
    if (this.adapters.has(definition.kind)) {
      throw new Error(
        `Source adapter already registered for kind: "${definition.kind}"`,
      );
    }
    this.adapters.set(
      definition.kind,
      definition as SourceAdapterDefinition<unknown>,
    );
  }

  get(kind: LiveSignalSourceType): SourceAdapterDefinition<unknown> | null {
    return this.adapters.get(kind) ?? null;
  }

  require(kind: LiveSignalSourceType): SourceAdapterDefinition<unknown> {
    const def = this.adapters.get(kind);
    if (!def) {
      throw new Error(`Source adapter not registered for kind: "${kind}"`);
    }
    return def;
  }

  list(): SourceAdapterDefinition<unknown>[] {
    return Array.from(this.adapters.values());
  }

  createSource(
    kind: LiveSignalSourceType,
    input: {
      definition: { id: string; config: Record<string, unknown>; configJson?: string };
      emit: (signals: MarketSignal[]) => Promise<void>;
    },
  ): ISignalSource {
    return this.require(kind).create(input);
  }
}

// ---------------------------------------------------------------------------
// Adapter definitions
// ---------------------------------------------------------------------------

function configJsonFrom(input: {
  definition: { config: Record<string, unknown>; configJson?: string };
}): string {
  return input.definition.configJson ?? JSON.stringify(input.definition.config);
}

function createEdgarAdapter(
  cikCache: CikTickerCache,
): SourceAdapterDefinition<Record<string, unknown>> {
  return {
    kind: "edgar_8k",
    configSchemaVersion: 1,
    configSchema: z.record(z.unknown()),
    outputContractId: "signal/filing",
    create(input) {
      return new EdgarSignalSource(
        input.definition.id,
        configJsonFrom(input),
        cikCache,
      );
    },
  };
}

const mockAdapter: SourceAdapterDefinition<Record<string, unknown>> = {
  kind: "mock",
  configSchemaVersion: 1,
  configSchema: z.object({
    ticker: z.string().optional(),
    companyName: z.string().optional(),
    instrumentClass: z
      .enum(["stock", "crypto", "futures", "options", "prediction_market"])
      .optional(),
    intervalMs: z.number().optional(),
  }),
  outputContractId: "signal/mock",
  create(input) {
    return new MockSignalSource(input.definition.id, configJsonFrom(input));
  },
};

const predictionEventAdapter: SourceAdapterDefinition<Record<string, unknown>> =
  {
    kind: "prediction_event",
    configSchemaVersion: 1,
    configSchema: z.object({
      triggerKind: z.string().optional(),
      pollIntervalMinutes: z.number().optional(),
      minLiquidityUsd: z.number().optional(),
      minPriceDeviation: z.number().optional(),
      categoryWhitelist: z.array(z.string()).optional(),
      curatedMarketSlugs: z.array(z.string()).optional(),
    }),
    outputContractId: "signal/prediction-event",
    create(input) {
      return new PredictionEventSignalSource(
        input.definition.id,
        configJsonFrom(input),
      );
    },
  };

const manualStub: SourceAdapterDefinition<Record<string, unknown>> = {
  kind: "manual",
  configSchemaVersion: 1,
  configSchema: z.record(z.unknown()),
  outputContractId: "signal/manual",
  create(_input) {
    throw new Error(
      `Signal source kind "manual" is implicit and cannot be instantiated via the adapter registry`,
    );
  },
};

// ---------------------------------------------------------------------------
// Wired registry factory
// ---------------------------------------------------------------------------

/**
 * Returns a SourceAdapterRegistry with all live-signal adapters registered.
 * Pass a CikTickerCache (or a DbClient wrapper) so the edgar adapter can
 * resolve SEC CIK → ticker mappings.
 */
export function createSourceAdapterRegistry(deps: {
  cikCache: CikTickerCache;
}): SourceAdapterRegistry {
  const registry = new SourceAdapterRegistry();
  registry.register(createEdgarAdapter(deps.cikCache));
  registry.register(mockAdapter);
  registry.register(predictionEventAdapter);
  registry.register(manualStub);
  return registry;
}
