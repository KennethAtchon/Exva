import { AppError } from "@electron/shared/infra/errors";
import type { BrokerAdapter } from "./adapters/broker-adapter";
import type { BrokerOrderV2 } from "./order-contract-v2";

export interface OptionsEntitlementSnapshot {
  optionsApprovedLevel: number | null;
  optionsTradingLevel: number | null;
  optionsBuyingPower: number | null;
}

/**
 * Pre-place gate for options orders (Solution 10 Tracer A).
 */
export async function assertOptionsEntitlements(
  adapter: BrokerAdapter,
  order: BrokerOrderV2,
): Promise<OptionsEntitlementSnapshot | null> {
  if (order.instrument.instrumentClass !== "options") return null;

  if (!adapter.getTradingEntitlements) {
    throw new AppError(
      "Options orders require adapter trading entitlements",
      "FORBIDDEN",
    );
  }

  const ent = await adapter.getTradingEntitlements();
  if (ent.tradingBlocked) {
    throw new AppError("Account trading_blocked", "FORBIDDEN");
  }
  if (ent.optionsApprovedLevel == null || ent.optionsApprovedLevel < 1) {
    throw new AppError(
      `options_approved_level=${ent.optionsApprovedLevel ?? "null"}`,
      "FORBIDDEN",
    );
  }
  if (ent.optionsTradingLevel == null || ent.optionsTradingLevel < 1) {
    throw new AppError(
      `options_trading_level=${ent.optionsTradingLevel ?? "null"}`,
      "FORBIDDEN",
    );
  }
  if (ent.optionsBuyingPower != null && ent.optionsBuyingPower <= 0) {
    throw new AppError(
      `options_buying_power=${ent.optionsBuyingPower}`,
      "BROKER_INSUFFICIENT_FUNDS",
    );
  }

  return {
    optionsApprovedLevel: ent.optionsApprovedLevel,
    optionsTradingLevel: ent.optionsTradingLevel,
    optionsBuyingPower: ent.optionsBuyingPower,
  };
}

/** Whole-contract sizing; vertical max debit as limit price. */
export function normalizeOptionsOrderShape(order: BrokerOrderV2): BrokerOrderV2 {
  if (order.instrument.instrumentClass !== "options") return order;

  if (order.quantity.kind === "units") {
    const whole = Math.max(1, Math.floor(order.quantity.value));
    if (!Number.isFinite(order.quantity.value) || whole !== order.quantity.value) {
      order.quantity = { kind: "units", value: whole };
    }
  }

  const legs = order.legs?.length ?? 0;
  if (legs >= 2 && order.orderType !== "limit") {
    order.orderType = "limit";
  }

  return order;
}
