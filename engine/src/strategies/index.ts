import type { StrategyInfo } from "@shared/types.ts";
import { z } from "zod";
import { InputError } from "../errors.ts";
import { aiAnalyst } from "./ai-analyst.ts";
import { donchianBreakout } from "./donchian-breakout.ts";
import { emaCross } from "./ema-cross.ts";
import { heartbeat } from "./heartbeat.ts";
import { rsiDip } from "./rsi-dip.ts";
import type { Strategy } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: the registry holds strategies with different param types
type AnyStrategy = Strategy<any>;

export const STRATEGIES: AnyStrategy[] = [heartbeat, emaCross, rsiDip, donchianBreakout, aiAnalyst];

export function getStrategy(id: string): AnyStrategy {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new InputError(`Unknown strategy "${id}"`);
  return s;
}

/** Validate params against the strategy's schema, filling defaults. Throws InputError on bad input. */
export function parseParams(strategy: AnyStrategy, raw: unknown): Record<string, unknown> {
  const res = strategy.params.safeParse(raw ?? {});
  if (!res.success)
    throw new InputError(`Invalid ${strategy.name} settings: ${z.prettifyError(res.error)}`);
  return res.data as Record<string, unknown>;
}

export function strategyInfo(s: AnyStrategy): StrategyInfo {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    usesAi: Boolean(s.usesAi),
    isTest: Boolean(s.isTest),
    timeframes: s.timeframes,
    defaultTimeframe: s.defaultTimeframe,
    defaultSymbols: s.defaultSymbols,
    params: z.toJSONSchema(s.params, { io: "input", unrepresentable: "any" }) as Record<
      string,
      unknown
    >,
    defaults: parseParams(s, {}),
  };
}
