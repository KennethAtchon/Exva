import type { InstrumentClass, Trade } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import {
  adapterCapabilitiesOf,
  type OrderRequest,
} from "../../../broker/adapters/broker-adapter";
import {
  adapterSupportsOrder,
  liftBrokerOrderV1ToV2,
  type OrderLeg,
} from "../../../broker/order-contract-v2";
import {
  assertOptionsEntitlements,
  normalizeOptionsOrderShape,
} from "../../../broker/options-entitlements-guard";
import type { TradingCycleContext } from "../trading-cycle-context";

function safeParseTradeOrderMetadata(
  json: string | null | undefined,
): {
  legs?: OrderLeg[];
  netDebit?: number;
  underlyingSymbol?: string;
  contracts?: number;
} | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed as {
      legs?: OrderLeg[];
      netDebit?: number;
      underlyingSymbol?: string;
      contracts?: number;
    };
  } catch {
    return null;
  }
}

export async function placeRoutedOrder(
  ctx: TradingCycleContext,
  trade: Trade,
  instrumentClass: InstrumentClass,
  riskOrder: OrderRequest,
  clientOrderId: string,
): Promise<{ brokerOrderId: string; filledAvgPrice: number } | null> {
  const { adapter, brokerAccountId } =
    await ctx.deps.brokerRouting.resolveAdapter(ctx.sessionId, instrumentClass);
  const caps = adapterCapabilitiesOf(adapter);
  ctx.deps.logger.debug(
    {
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      brokerAccountId,
      instrumentClass,
      brokerType: adapter.brokerType,
      capabilities: caps,
    },
    "resolved broker adapter",
  );

  if (
    ctx.deps.tradesRepo.checkInstrumentConflict(
      brokerAccountId,
      trade.instrumentSymbol,
      ctx.sessionId,
    )
  ) {
    ctx.deps.logger.warn(
      {
        sessionId: ctx.sessionId,
        tradeId: trade.id,
        brokerAccountId,
        instrumentSymbol: trade.instrumentSymbol,
      },
      "order skipped: instrument conflict detected",
    );
    return null;
  }

  const wireSymbol = ctx.deps.instrumentNormalizer.toBrokerSymbol({
    symbol: trade.instrumentSymbol,
    instrumentClass,
    brokerType: adapter.brokerType,
  });

  ctx.deps.logger.info(
    {
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      brokerAccountId,
      brokerType: adapter.brokerType,
      wireSymbol,
      side: riskOrder.side,
      sizeUsd: riskOrder.sizeUsd,
      clientOrderId,
    },
    "placing broker order",
  );

  const v1Order = {
    instrumentSymbol: wireSymbol,
    instrumentDisplayName: trade.instrumentDisplayName ?? null,
    predictionOutcome: trade.predictionOutcome ?? null,
    instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
    instrumentType: instrumentClass,
    side: riskOrder.side,
    sizeUsd: riskOrder.sizeUsd,
    clientOrderId,
  };

  const liftedOrder = normalizeOptionsOrderShape(liftBrokerOrderV1ToV2(v1Order));

  // Solution 10: attach multi-leg OCC vertical when trade metadata carries legs.
  const meta = safeParseTradeOrderMetadata(trade.instrumentMetadataJson);
  if (meta?.legs && Array.isArray(meta.legs) && meta.legs.length >= 2) {
    liftedOrder.legs = meta.legs as import("../../../broker/order-contract-v2").OrderLeg[];
    if (typeof meta.netDebit === "number") {
      liftedOrder.orderType = "limit";
      liftedOrder.limitPrice = meta.netDebit;
    }
    if (typeof meta.underlyingSymbol === "string") {
      liftedOrder.instrument.symbol = meta.underlyingSymbol;
      liftedOrder.instrument.instrumentClass = "options";
    }
    if (typeof meta.contracts === "number" && meta.contracts >= 1) {
      liftedOrder.quantity = { kind: "units", value: Math.floor(meta.contracts) };
    }
  }

  const support = adapterSupportsOrder(caps, liftedOrder);
  if (!support.ok) {
    ctx.deps.logger.warn(
      {
        sessionId: ctx.sessionId,
        tradeId: trade.id,
        brokerAccountId,
        brokerType: adapter.brokerType,
        reason: support.reason,
        capabilities: caps,
      },
      "order skipped: adapter does not support order shape",
    );
    return null;
  }

  if (ctx.deps.isOrderHalted?.()) {
    ctx.deps.logger.warn(
      {
        sessionId: ctx.sessionId,
        tradeId: trade.id,
        brokerAccountId,
        clientOrderId,
      },
      "order refused: kill-switch halt engaged",
    );
    throw new AppError("Order refused: kill switch is engaged", "FORBIDDEN", {
      sessionId: ctx.sessionId,
      tradeId: trade.id,
    });
  }

  if (liftedOrder.instrument.instrumentClass === "options") {
    try {
      await assertOptionsEntitlements(adapter, liftedOrder);
    } catch (err) {
      ctx.deps.logger.warn(
        {
          sessionId: ctx.sessionId,
          tradeId: trade.id,
          brokerAccountId,
          err,
        },
        "order skipped: options entitlements gate failed",
      );
      return null;
    }
  }

  ctx.deps.orderIntents?.persist(adapter, {
    sessionId: ctx.sessionId,
    brokerAccountId,
    canonicalClientOrderId: clientOrderId,
    side: riskOrder.side,
    symbol: wireSymbol,
    notionalUsd: riskOrder.sizeUsd,
    quantity:
      liftedOrder.quantity.kind === "units"
        ? liftedOrder.quantity.value
        : undefined,
    originKind: "strategy",
  });

  let result;
  try {
    const placeV2 = adapter.placeOrderV2?.bind(adapter);
    const hasLegs = (liftedOrder.legs?.length ?? 0) >= 2;
    const useV2 =
      placeV2 != null &&
      (hasLegs || caps.orderTypes.includes("market"));
    result = useV2
      ? await placeV2(liftedOrder)
      : await adapter.placeOrder(v1Order);
  } catch (err) {
    ctx.deps.logger.error(
      {
        err,
        sessionId: ctx.sessionId,
        tradeId: trade.id,
        brokerAccountId,
        brokerType: adapter.brokerType,
        wireSymbol,
      },
      "broker order placement threw",
    );
    throw err;
  }

  if (trade.brokerAccountId !== brokerAccountId) {
    ctx.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
  }

  ctx.deps.orderIntents?.acknowledge(
    brokerAccountId,
    clientOrderId,
    result.brokerOrderId,
  );

  ctx.deps.logger.info(
    {
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      brokerAccountId,
      brokerOrderIdLength: result.brokerOrderId.length,
      filledAvgPrice: result.filledAvgPrice,
    },
    "broker order placed",
  );

  return {
    brokerOrderId: result.brokerOrderId,
    filledAvgPrice: result.filledAvgPrice,
  };
}
