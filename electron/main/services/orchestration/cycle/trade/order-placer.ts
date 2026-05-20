import type { InstrumentClass, Trade } from "@/lib/types";
import type { OrderRequest } from "../../../broker/adapters/broker-adapter";
import type { OrchestratorContext } from "../orchestrator-context";

export async function placeRoutedOrder(
  ctx: OrchestratorContext,
  trade: Trade,
  instrumentClass: InstrumentClass,
  riskOrder: OrderRequest,
  clientOrderId: string,
): Promise<{ brokerOrderId: string; filledAvgPrice: number } | null> {
  const { adapter, brokerAccountId } = await ctx.deps.brokerRouting.resolveAdapter(ctx.sessionId, instrumentClass);
  ctx.deps.logger.debug(
    { sessionId: ctx.sessionId, tradeId: trade.id, brokerAccountId, instrumentClass, brokerType: adapter.brokerType },
    "resolved broker adapter",
  );

  if (ctx.deps.tradesRepo.checkInstrumentConflict(brokerAccountId, trade.instrumentSymbol, ctx.sessionId)) {
    return null;
  }

  const wireSymbol = ctx.deps.instrumentNormalizer.toBrokerSymbol({
    symbol: trade.instrumentSymbol,
    instrumentClass,
    brokerType: adapter.brokerType,
  });

  const result = await adapter.placeOrder({
    instrumentSymbol: wireSymbol,
    instrumentDisplayName: trade.instrumentDisplayName ?? null,
    predictionOutcome: trade.predictionOutcome ?? null,
    instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
    instrumentType: instrumentClass,
    side: riskOrder.side,
    sizeUsd: riskOrder.sizeUsd,
    clientOrderId,
  });

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

  return { brokerOrderId: result.brokerOrderId, filledAvgPrice: result.filledAvgPrice };
}
