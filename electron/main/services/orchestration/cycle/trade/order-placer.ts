import type { InstrumentClass, Trade } from "@/lib/types";
import type { OrderRequest } from "../../../broker/adapters/broker-adapter";
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
  ctx.deps.logger.debug(
    {
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      brokerAccountId,
      instrumentClass,
      brokerType: adapter.brokerType,
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

  let result;
  try {
    result = await adapter.placeOrder({
      instrumentSymbol: wireSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentType: instrumentClass,
      side: riskOrder.side,
      sizeUsd: riskOrder.sizeUsd,
      clientOrderId,
    });
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
