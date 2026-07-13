import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AutopsyLesson,
  PeriodAutopsyRecord,
  TradeAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import type { Trade } from "@/lib/types";

const showSaveDialog = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  dialog: { showSaveDialog },
  BrowserWindow: vi.fn(),
}));

import { AutopsyExportService } from "../autopsy-export-service";

const TRADE: Trade = {
  id: "trade-1",
  sessionId: "session-1",
  brokerAccountId: null,
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
  low_water_mark_price: null,
  exit_reason: "target_hit",
  client_order_id: null,
  close_market_snapshot_json: null,
  created_at: "2026-05-20T13:55:00.000Z",
};

const STRUCTURED = {
  executiveSummary: "Solid entry with disciplined exit.",
  thesisReview: {
    valid: true,
    analysis: "Thesis held through the session.",
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
};

const AUTOPSY: TradeAutopsyRecord = {
  id: "autopsy-1",
  tradeId: TRADE.id,
  sessionId: "session-1",
  modelId: "model-1",
  summary: "Fallback summary.",
  summaryStructuredJson: JSON.stringify(STRUCTURED),
  phaseTracesJson: "[]",
  qualityGrade: "B",
  qualityScore: 82,
  isFallback: false,
  createdAt: "2026-05-21T10:00:00.000Z",
  createdBy: "system",
};

const LESSON: AutopsyLesson = {
  id: "lesson-1",
  autopsyId: AUTOPSY.id,
  tradeId: TRADE.id,
  sessionId: "session-1",
  lesson: "Keep position size aligned with conviction.",
  severity: "medium",
  category: "risk",
  proposedFix: "Reuse the same sizing checklist.",
  status: "pending",
  recurrenceCount: 0,
  source: "trade",
  scope: "session",
  createdAt: "2026-05-21T10:00:00.000Z",
  updatedAt: "2026-05-21T10:00:00.000Z",
  validatedAt: null,
};

const PERIOD_AUTOPSY: PeriodAutopsyRecord = {
  id: "period-1",
  scope: "session",
  sessionId: "session-1",
  windowStart: "2026-05-01T00:00:00.000Z",
  windowEnd: "2026-05-31T23:59:59.999Z",
  modelId: "model-1",
  filtersJson: "{}",
  tradeCount: 1,
  tradeIdsJson: JSON.stringify([TRADE.id]),
  summaryStructuredJson: JSON.stringify({
    executiveSummary: "One-trade window.",
    performancePatterns: {
      winRate: 1,
      totalTrades: 1,
      winners: 1,
      losers: 0,
      avgPnlUsd: 42,
      bestPnlUsd: 42,
      worstPnlUsd: 42,
      avgHoldDurationMs: 14_400_000,
      sizingConsistency: "consistent",
      entryTimingPattern: "on plan",
      regimeNotes: "trending",
    },
    recurringFailureModes: [],
    lessonsNew: [],
    lessonsValidated: [],
    lessonsRecurring: [],
    andonAssessment: { shouldFire: false, reasons: [] },
    processImprovements: ["Review sizing weekly."],
  }),
  phaseTracesJson: "[]",
  qualityGrade: "B",
  qualityScore: 80,
  isFallback: false,
  totalCostUsd: 0.12,
  createdAt: "2026-05-21T11:00:00.000Z",
  createdBy: "system",
};

describe("AutopsyExportService.export", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopsy-export-"));
  const service = new AutopsyExportService();

  afterEach(() => {
    showSaveDialog.mockReset();
  });

  it("returns cancelled when save dialog is dismissed", async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });

    const result = await service.export(
      "json",
      AUTOPSY,
      [],
      TRADE,
      "Paper Session",
    );

    expect(result).toEqual({ cancelled: true });
  });

  it("writes JSON export with autopsy, structured summary, lessons, and trade snapshot", async () => {
    const filePath = path.join(tmpDir, "trade-autopsy.json");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath });

    const result = await service.export(
      "json",
      AUTOPSY,
      [LESSON],
      TRADE,
      "Paper Session",
    );

    expect(result).toMatchObject({ path: filePath });
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      autopsy: TradeAutopsyRecord;
      structured: typeof STRUCTURED;
      lessons: AutopsyLesson[];
      trade: Pick<Trade, "id" | "instrumentSymbol" | "side" | "strategy"> & {
        final_pnl_usd: number | null;
      };
      sessionName: string;
    };

    expect(payload.autopsy.id).toBe(AUTOPSY.id);
    expect(payload.structured.executiveSummary).toBe(
      STRUCTURED.executiveSummary,
    );
    expect(payload.lessons).toHaveLength(1);
    expect(payload.trade).toMatchObject({
      id: TRADE.id,
      instrumentSymbol: "AAPL",
      side: "BUY",
      final_pnl_usd: 42,
    });
    expect(payload.sessionName).toBe("Paper Session");
  });

  it("writes markdown export with executive summary and lesson sections", async () => {
    const filePath = path.join(tmpDir, "trade-autopsy.md");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath });

    const result = await service.export(
      "markdown",
      AUTOPSY,
      [LESSON],
      TRADE,
      "Paper Session",
    );

    expect(result).toMatchObject({ filename: "trade-autopsy.md" });
    const markdown = fs.readFileSync(filePath, "utf8");
    expect(markdown).toContain("# Trade Autopsy — AAPL BUY");
    expect(markdown).toContain("Solid entry with disciplined exit.");
    expect(markdown).toContain("Keep position size aligned with conviction.");
  });

  it("returns error for PDF export without renderer webContents", async () => {
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: path.join(tmpDir, "trade-autopsy.pdf"),
    });

    const result = await service.export(
      "pdf",
      AUTOPSY,
      [],
      TRADE,
      "Paper Session",
    );

    expect(result).toMatchObject({
      error: "PDF export requires an active renderer window.",
    });
  });
});

describe("AutopsyExportService.exportPeriod", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "period-autopsy-export-"),
  );
  const service = new AutopsyExportService();

  afterEach(() => {
    showSaveDialog.mockReset();
  });

  it("writes JSON export with period autopsy, structured summary, and trades", async () => {
    const filePath = path.join(tmpDir, "period-autopsy.json");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath });

    const result = await service.exportPeriod(
      "json",
      PERIOD_AUTOPSY,
      [LESSON],
      [TRADE],
    );

    expect(result).toMatchObject({ path: filePath });
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      autopsy: PeriodAutopsyRecord;
      structured: { executiveSummary: string };
      lessons: AutopsyLesson[];
      trades: Trade[];
    };

    expect(payload.autopsy.id).toBe(PERIOD_AUTOPSY.id);
    expect(payload.structured.executiveSummary).toBe("One-trade window.");
    expect(payload.trades).toHaveLength(1);
    expect(payload.lessons[0]?.lesson).toBe(LESSON.lesson);
  });

  it("writes markdown export with performance and included trades", async () => {
    const filePath = path.join(tmpDir, "period-autopsy.md");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath });

    await service.exportPeriod("markdown", PERIOD_AUTOPSY, [], [TRADE]);

    const markdown = fs.readFileSync(filePath, "utf8");
    expect(markdown).toContain("# Period Autopsy — session");
    expect(markdown).toContain("Win rate: 100.0%");
    expect(markdown).toContain("AAPL BUY · 42 USD");
  });
});
