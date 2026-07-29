/**
 * Options Flow producer (Solution 10 Tracer A).
 * Chain snapshot → UOA → deterministic OCC / vertical selection → signal fact.
 */

import type { DeterministicSignalFactV1 } from "@electron/shared/domain/deterministic-signal-fact";
import type { OptionChainContract } from "../broker/adapters/broker-adapter";
import type { OrderLeg } from "../broker/order-contract-v2";
import { computeOptionsFlowSignal } from "./strategy/options-flow-signal";
import {
  selectVerticalSpread,
  type VerticalSpread,
} from "./scoring/vertical-spread-selector";
import type { OptionContract } from "./scoring/option-contract-selector";

export interface OptionsFlowProducerInput {
  underlyingSymbol: string;
  chain: readonly OptionChainContract[];
  volumeOiRatioThreshold?: number;
  bullishSkewThreshold?: number;
  targetWidth?: number;
  /** Whole contracts only. */
  contracts?: number;
  signalId?: string;
  sessionInputGroupKey?: string;
  strategyImplementationVersion?: number;
  strategyParameters?: Record<string, unknown>;
}

export type OptionsFlowProducerResult =
  | {
      kind: "setup";
      fact: DeterministicSignalFactV1;
      spread: VerticalSpread;
      legs: OrderLeg[];
      contracts: number;
      maxDebitUsd: number;
      reason: string;
    }
  | {
      kind: "no_setup" | "insufficient_chain" | "no_contract";
      reason: string;
    };

function toSelectorContracts(
  chain: readonly OptionChainContract[],
): OptionContract[] {
  const now = Date.now();
  const out: OptionContract[] = [];
  for (const c of chain) {
    if (c.delta == null || c.bid == null || c.ask == null) continue;
    if (c.bid <= 0 || c.ask <= 0) continue;
    const expiryMs = Date.parse(c.expiry);
    const daysToExpiry = Number.isFinite(expiryMs)
      ? Math.max(0, Math.round((expiryMs - now) / 86_400_000))
      : 30;
    out.push({
      symbol: c.symbol,
      type: c.type,
      delta: Math.abs(c.delta),
      openInterest: c.openInterest,
      bid: c.bid,
      ask: c.ask,
      daysToExpiry,
    });
  }
  return out;
}

/**
 * Compose chain → UOA → vertical → DeterministicSignalFactV1.
 * Sizing is whole contracts; max loss = net debit × 100 × contracts.
 */
export function produceOptionsFlowSignal(
  input: OptionsFlowProducerInput,
): OptionsFlowProducerResult {
  const contracts = Math.max(1, Math.floor(input.contracts ?? 1));
  if (input.chain.length === 0) {
    return {
      kind: "insufficient_chain",
      reason: "Option chain empty — check feed entitlement.",
    };
  }

  let callVolume = 0;
  let putVolume = 0;
  let callOpenInterest = 0;
  let putOpenInterest = 0;
  for (const c of input.chain) {
    if (c.type === "call") {
      callVolume += c.dayVolume;
      callOpenInterest += c.openInterest;
    } else {
      putVolume += c.dayVolume;
      putOpenInterest += c.openInterest;
    }
  }

  const uoa = computeOptionsFlowSignal({
    underlyingSymbol: input.underlyingSymbol,
    callVolume,
    putVolume,
    callOpenInterest,
    putOpenInterest,
    ivPercentile: null,
    volumeOiRatioThreshold: input.volumeOiRatioThreshold ?? 2,
    bullishSkewThreshold: input.bullishSkewThreshold ?? 0.6,
  });

  if (uoa.action === "skip") {
    return { kind: "no_setup", reason: uoa.reasoning };
  }

  const selectorChain = toSelectorContracts(input.chain);
  const selection = selectVerticalSpread(selectorChain, uoa.action, {
    targetDelta: 0.4,
    minOpenInterest: 100,
    maxSpreadPct: 0.25,
    minDaysToExpiry: 7,
    maxDaysToExpiry: 45,
    targetWidth: input.targetWidth ?? 5,
    maxDebitPctOfWidth: 0.6,
  });

  if (!selection.spread) {
    return { kind: "no_contract", reason: selection.reason };
  }

  const spread = selection.spread;
  const legs: OrderLeg[] = [
    {
      symbol: spread.longLeg.symbol,
      side: "BUY",
      quantity: contracts,
      positionEffect: "open",
    },
    {
      symbol: spread.shortLeg.symbol,
      side: "SELL",
      quantity: contracts,
      positionEffect: "open",
    },
  ];

  // Options multiplier: $100 per point of debit.
  const maxDebitUsd = spread.netDebit * 100 * contracts;
  const now = new Date().toISOString();
  const signalId = input.signalId ?? crypto.randomUUID();

  const fact: DeterministicSignalFactV1 = {
    schemaVersion: 1,
    signalId,
    originKind: "strategy",
    sessionInputGroupKey: input.sessionInputGroupKey ?? "options-flow",
    strategyId: "options-flow",
    strategyImplementationVersion: input.strategyImplementationVersion ?? 2,
    strategyParameters: input.strategyParameters ?? {},
    symbol: input.underlyingSymbol,
    instrumentClass: "options",
    timeframe: "1d",
    evaluatedAt: now,
    newestBarTs: now,
    barWindowHash: `opts:${input.underlyingSymbol}:${spread.longLeg.symbol}:${spread.shortLeg.symbol}`,
    action: uoa.action,
    strength: uoa.confidence,
    evidence: {
      volumeOiRatio:
        (callVolume + putVolume) /
        Math.max(callOpenInterest + putOpenInterest, 1),
      callShare: callVolume / Math.max(callVolume + putVolume, 1),
      netDebit: spread.netDebit,
      maxLoss: spread.maxLoss,
      maxDebitUsd,
      contracts,
      width: spread.width,
    },
  };

  return {
    kind: "setup",
    fact,
    spread,
    legs,
    contracts,
    maxDebitUsd,
    reason: `${uoa.reasoning} ${selection.reason}`,
  };
}
