import type { InstrumentClass } from "@/lib/types";

export interface ExecutionProfileInput {
  instrumentClass: InstrumentClass;
  action: "buy" | "sell";
  maxPositionUsd: number;
  maxExposureUsd: number | null;
}

export interface ExecutionProfile {
  positionSizeUsd: number;
  side: "BUY" | "SELL";
}

export function computeExecutionProfile(input: ExecutionProfileInput): ExecutionProfile {
  const { action, maxPositionUsd, maxExposureUsd } = input;

  const positionSizeUsd = maxExposureUsd != null
    ? Math.min(maxPositionUsd, maxExposureUsd)
    : maxPositionUsd;

  return {
    positionSizeUsd,
    side: action === "sell" ? "SELL" : "BUY",
  };
}
