import type { InstrumentClass, Trade } from "@/lib/types";
import {
  adapterCapabilitiesOf,
  type OrderRequest,
} from "../../../broker/adapters/broker-adapter";
import {
  adapterSupportsOrder,
  liftBrokerOrderV1ToV2,
} from "../../../broker/order-contract-v2";
import type { TradingCycleContext } from "../trading-cycle-context";

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

  const liftedOrder = liftBrokerOrderV1ToV2(v1Order);
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

  let result;
  try {
    // Prefer v2 when the adapter implements it and advertises market orders;
    // lift keeps market+notional shape so existing adapters/tests stay compatible.
    const placeV2 = adapter.placeOrderV2?.bind(adapter);
    const useV2 = placeV2 != null && caps.orderTypes.includes("market");
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
