import { describe, expect, it, vi } from "vitest";
import {
  parseAutopsyStructuredJson,
  type AddLessonInput,
  type TradeAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import { TradeAutopsyService } from "../trade-autopsy-service";

const CLOSED_TRADE = {
  id: "trade-1",
  sessionId: "session-1",
  instrumentSymbol: "AAPL",
  instrumentDisplayName: "Apple",
  predictionOutcome: null,
  instrumentMetadataJson: null,
  instrumentType: "stock",
  side: "BUY",
  entry_price: 100,
  position_size_usd: 1000,
  stop_loss_price: 95,
  take_profit_price: 110,
  strategy: "trend_momentum",
  execution_strategy: null,
  status: "closed",
  opened_at: "2026-05-20T14:00:00.000Z",
  closed_at: "2026-05-20T18:00:00.000Z",
  final_pnl_usd: 42,
  ai_cost_usd: 0,
  confidence_score: 0.7,
  broker_order_id: null,
  high_water_mark_price: null,
  exit_reason: "target_hit",
  client_order_id: null,
  close_market_snapshot_json: null,
  created_at: "2026-05-20T13:55:00.000Z",
} as const;

function createService() {
  const insertLesson = vi.fn();
  const insertAutopsy = vi
    .fn()
    .mockImplementation(
      (record: Omit<TradeAutopsyRecord, "id"> & { id?: string }) => ({
        ...record,
        id: record.id ?? "autopsy-1",
      }),
    );
  const service = new TradeAutopsyService({
    trades: { require: () => CLOSED_TRADE } as never,
    agentMessages: { listByTrade: () => [] } as never,
    autopsies: { insert: insertAutopsy, listByTrade: () => [] } as never,
    lessons: {
      insert: insertLesson,
      listByAutopsy: () => [],
      require: vi.fn(),
      update: vi.fn(),
    } as never,
    providerRegistry: {
      get: async () => ({
        generateText: async () => ({
          text: JSON.stringify({
            executiveSummary: "Solid review.",
            qualityGrade: "B",
            qualityScore: 82,
            thesisReview: {
              valid: true,
              analysis: "Reasonable thesis.",
              confirmatoryBias: false,
              prematureConviction: false,
              ignoredCounterSignals: [],
            },
            executionQuality: {
              entryTiming: "good",
              sizingAdequacy: "appropriate",
              exitManagement: "Held to plan.",
              slippage: null,
            },
            behavioralFlags: [],
            marketContext: {
              regime: "trending",
              macro: "Supportive.",
              volatility: "Normal.",
              suitability: "good_conditions",
            },
            whatWorked: ["Entry discipline"],
            whatFailed: [],
            rootCause: null,
            processImprovements: ["Keep risk sizing consistent."],
            lessons: [
              {
                lesson: "Keep position size aligned with conviction.",
                severity: "medium",
                category: "risk",
                proposedFix: "Reuse the same sizing checklist.",
              },
            ],
          }),
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 10,
        }),
      }),
    } as never,
    workspacePrefs: {
      get: () => ({
        defaultModelProviderKey: "provider-1",
        defaultModelModelId: "model-1",
      }),
    } as never,
  });

  return { service, insertAutopsy, insertLesson };
}

describe("parseAutopsyStructuredJson", () => {
  it("returns null for legacy default rows", () => {
    expect(parseAutopsyStructuredJson("{}")).toBeNull();
  });
});

describe("TradeAutopsyService", () => {
  it("creates trade-scoped lessons without period or Andon wiring", async () => {
    const { service, insertAutopsy, insertLesson } = createService();

    await service.summarize(CLOSED_TRADE.id);

    expect(insertAutopsy).toHaveBeenCalledTimes(1);
    expect(insertLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        autopsyId: "autopsy-1",
        periodAutopsyId: null,
        tradeId: CLOSED_TRADE.id,
        sessionId: CLOSED_TRADE.sessionId,
        source: "trade",
        scope: "session",
      }),
    );
  });

  it("adds manual trade lessons as trade-scoped rows", () => {
    const insertLesson = vi.fn((input: AddLessonInput) => input);
    const service = new TradeAutopsyService({
      trades: {} as never,
      agentMessages: {} as never,
      autopsies: {} as never,
      lessons: { insert: insertLesson } as never,
      providerRegistry: {} as never,
      workspacePrefs: {} as never,
    });

    service.addLesson({
      autopsyId: "autopsy-1",
      tradeId: "trade-1",
      sessionId: "session-1",
      lesson: "Tighten stop placement.",
      severity: "high",
      category: "risk",
      proposedFix: "Anchor stops to invalidation.",
    });

    expect(insertLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        autopsyId: "autopsy-1",
        periodAutopsyId: null,
        tradeId: "trade-1",
        sessionId: "session-1",
        source: "trade",
        scope: "session",
      }),
    );
  });
});
