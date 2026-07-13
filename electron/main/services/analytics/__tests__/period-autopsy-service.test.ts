import { describe, expect, it, vi } from "vitest";
import type {
  AutopsyLesson,
  PeriodAutopsyRecord,
  PeriodAutopsyRunInput,
} from "@electron/shared/domain/autopsy";
import { PeriodAutopsyService } from "../period-autopsy-service";

const RUN_INPUT: PeriodAutopsyRunInput = {
  scope: "session",
  sessionId: "session-1",
  windowStart: "2026-05-01T00:00:00.000Z",
  windowEnd: "2026-05-31T23:59:59.999Z",
  filters: {
    instrumentClasses: [],
    brokerAccountIds: [],
    outcome: "all",
    minPositionSizeUsd: 0,
    includeAgentPhases: [],
  },
  providerKey: "provider-1",
  modelId: "model-1",
  confirmHighCost: true,
};

const SAMPLE_TRADE = {
  id: "trade-1",
  sessionId: "session-1",
  brokerAccountId: "broker-1",
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
  final_pnl_usd: 50,
  ai_cost_usd: 0,
  confidence_score: 0.7,
  broker_order_id: null,
  high_water_mark_price: null,
  low_water_mark_price: null,
  exit_reason: "target_hit",
  client_order_id: null,
  close_market_snapshot_json: null,
  created_at: "2026-05-20T13:55:00.000Z",
} as const;

function makeLesson(overrides: Partial<AutopsyLesson> = {}): AutopsyLesson {
  return {
    id: "lesson-1",
    autopsyId: "period-0",
    tradeId: null,
    sessionId: "session-1",
    lesson: "Stop moving stops in drawdown.",
    severity: "critical",
    category: "risk",
    proposedFix: "Anchor stops before entry.",
    status: "recurring",
    recurrenceCount: 2,
    source: "period",
    scope: "session",
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    validatedAt: null,
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<PeriodAutopsyRecord> = {},
): PeriodAutopsyRecord {
  return {
    id: "period-1",
    scope: "session",
    sessionId: "session-1",
    windowStart: RUN_INPUT.windowStart,
    windowEnd: RUN_INPUT.windowEnd,
    modelId: "model-1",
    filtersJson: JSON.stringify(RUN_INPUT.filters),
    tradeCount: 1,
    tradeIdsJson: JSON.stringify([SAMPLE_TRADE.id]),
    summaryStructuredJson: "{}",
    phaseTracesJson: "[]",
    qualityGrade: null,
    qualityScore: null,
    isFallback: false,
    totalCostUsd: 0,
    createdAt: "2026-05-21T00:00:00.000Z",
    createdBy: "user",
    ...overrides,
  };
}

function createService(options?: {
  priorLessons?: AutopsyLesson[];
  latestAutopsy?: PeriodAutopsyRecord | null;
  phaseTexts?: string[];
}) {
  const phaseTexts = options?.phaseTexts ?? [
    JSON.stringify({
      recurringFailureModes: [],
      sizingConsistency: "Sizing stayed controlled.",
      entryTimingPattern: "Entries were patient overall.",
      regimeNotes: "Trend conditions were favorable.",
      behavioralDrift: "No clear drift.",
      outlierTradeIds: [],
    }),
    JSON.stringify({ evaluations: [] }),
    JSON.stringify({
      executiveSummary: "A steady review window with controlled execution.",
      qualityGrade: "B",
      qualityScore: 84,
      lessonsNew: [
        {
          lesson: "Keep sizing aligned with conviction.",
          severity: "medium",
          category: "risk",
          proposedFix: "Reuse the pre-trade sizing checklist.",
        },
      ],
      processImprovements: ["Keep journaling the best and worst trades."],
      andonAssessment: { shouldFire: false, reasons: [] },
    }),
  ];

  const recordInsert = vi.fn(
    (record: Omit<PeriodAutopsyRecord, "id"> & { id?: string }) => ({
      ...record,
      id: record.id ?? "period-new",
    }),
  );
  const lessonInsert = vi.fn();
  const lessonUpdate = vi.fn();
  const eventInsert = vi.fn();
  const eventEmit = vi.fn();

  const service = new PeriodAutopsyService({
    sessions: { requireById: () => ({ id: "session-1" }) } as never,
    trades: {
      listClosedInWindow: () => [SAMPLE_TRADE],
    } as never,
    agentMessages: {
      listByTrades: () => [],
    } as never,
    autopsies: {
      findLatestByScope: vi.fn(() => options?.latestAutopsy ?? null),
      findLatestByTrade: () => null,
      insertPeriod: recordInsert,
      listByScope: vi.fn(),
      requirePeriod: vi.fn(),
    } as never,
    lessons: {
      listByScope: () => options?.priorLessons ?? [],
      insert: lessonInsert,
      update: lessonUpdate,
      findSimilar: () => null,
      require: vi.fn(),
    } as never,
    events: { insert: eventInsert } as never,
    providerRegistry: {
      get: async () => ({
        generateText: async () => ({
          text: phaseTexts.shift() ?? "{}",
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 5,
        }),
      }),
    } as never,
    workspacePrefs: {
      get: () => ({
        globalEnvironmentMode: "paper",
        defaultModelProviderKey: "provider-1",
        defaultModelModelId: "model-1",
      }),
    } as never,
    eventBus: { emit: eventEmit } as never,
  });

  return {
    service,
    recordInsert,
    lessonInsert,
    lessonUpdate,
    eventInsert,
    eventEmit,
  };
}

describe("PeriodAutopsyService", () => {
  it("previews trade count and latest run metadata", () => {
    const latest = makeRecord({
      createdAt: "2026-05-22T00:00:00.000Z",
      tradeCount: 7,
    });
    const { service } = createService({ latestAutopsy: latest });

    const preview = service.preview(RUN_INPUT);

    expect(preview.tradeCount).toBe(1);
    expect(preview.lastAutopsyAt).toBe(latest.createdAt);
    expect(preview.lastAutopsyTradeCount).toBe(7);
  });

  it("creates a period autopsy record and period-sourced lessons", async () => {
    const { service, recordInsert, lessonInsert, eventEmit } = createService();

    await service.run(RUN_INPUT);

    expect(recordInsert).toHaveBeenCalledTimes(1);
    expect(lessonInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        autopsyId: "period-new",
        source: "period",
        scope: "session",
      }),
    );
    expect(eventEmit).not.toHaveBeenCalled();
  });

  it("fires Andon only from period runs when a high-severity lesson recurs again", async () => {
    const recurringLesson = makeLesson();
    const { service, lessonUpdate, eventInsert, eventEmit } = createService({
      latestAutopsy: makeRecord({ id: "period-old" }),
      priorLessons: [recurringLesson],
      phaseTexts: [
        JSON.stringify({
          recurringFailureModes: [
            {
              category: "risk",
              count: 2,
              description: "Stops were moved during drawdown.",
              tradeIds: [SAMPLE_TRADE.id],
            },
          ],
          sizingConsistency: "Sizing stayed controlled.",
          entryTimingPattern: "Entries were patient overall.",
          regimeNotes: "Trend conditions were favorable.",
          behavioralDrift: "No clear drift.",
          outlierTradeIds: [],
        }),
        JSON.stringify({
          evaluations: [
            {
              lessonId: recurringLesson.id,
              status: "recurring",
              reason: "Same failure pattern.",
            },
          ],
        }),
        JSON.stringify({
          executiveSummary:
            "The same high-severity risk error is still recurring.",
          qualityGrade: "D",
          qualityScore: 42,
          lessonsNew: [],
          processImprovements: ["Pause and rework stop discipline."],
          andonAssessment: { shouldFire: true, reasons: [] },
        }),
      ],
    });

    await service.run(RUN_INPUT);

    expect(lessonUpdate).toHaveBeenCalledWith(
      recurringLesson.id,
      expect.objectContaining({ recurrenceCount: 3, status: "recurring" }),
    );
    expect(eventEmit).toHaveBeenCalledWith(
      "andon_cord_fired",
      expect.objectContaining({
        lessonId: recurringLesson.id,
        recurrenceCount: 3,
        scope: "session",
        periodAutopsyId: "period-new",
      }),
    );
    expect(eventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "CRITICAL",
        agent_type: "period_autopsy",
      }),
    );
  });
});
