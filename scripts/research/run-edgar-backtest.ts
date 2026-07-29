#!/usr/bin/env bun
/**
 * One-command EDGAR drift backtest runner.
 * Writes JSON results under research/output/.
 *
 * Usage: bun run scripts/research/run-edgar-backtest.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyEdgarPrefilters,
  computeConfidenceCalibration,
  computeForwardReturns,
  runAblationReport,
  runHoldPeriodSweep,
  sliceByRegime,
  summarizeByItemCode,
  summarizeByItemCodeAndPolarity,
  summarizeDriftFeatures,
  type FilingRecord,
  type OhlcvBar,
} from "../../electron/main/services/backtest/edgar-drift-backtest";
import { EDGAR_RESEARCH_ITEM_CODES } from "../../electron/shared/instruments/edgar-item-codes";

const OUTPUT_DIR = join(import.meta.dir, "..", "..", "research", "output");

const SAMPLE_FILINGS: FilingRecord[] = [
  {
    accessionNumber: "0001",
    ticker: "NVDA",
    filedAt: "2026-01-10T14:30:00.000Z",
    itemCodes: ["1.01"],
    marketCapBucket: "mega",
    headline: "Entry into material definitive agreement",
    entryPriceUsd: 140,
    entryVolumeShares: 2_000_000,
    spreadPct: 0.08,
  },
  {
    accessionNumber: "0002",
    ticker: "AMD",
    filedAt: "2026-01-12T10:00:00.000Z",
    itemCodes: ["2.02"],
    marketCapBucket: "large",
    headline: "Results of operations beat expectations",
    entryPriceUsd: 95,
    entryVolumeShares: 1_500_000,
    spreadPct: 0.12,
  },
  {
    accessionNumber: "0003",
    ticker: "NVDA",
    filedAt: "2026-01-15T16:00:00.000Z",
    itemCodes: ["8.01"],
    marketCapBucket: "mega",
    headline: "Other events — operational update",
    entryPriceUsd: 142,
    entryVolumeShares: 1_800_000,
    spreadPct: 0.09,
  },
  {
    accessionNumber: "0004",
    ticker: "XYZ",
    filedAt: "2026-01-16T11:00:00.000Z",
    itemCodes: ["1.03"],
    marketCapBucket: "small",
    headline: "Bankruptcy or receivership filing",
    entryPriceUsd: 3,
    entryVolumeShares: 50_000,
    spreadPct: 1.2,
  },
  {
    accessionNumber: "0005",
    ticker: "ABC",
    filedAt: "2026-01-17T13:00:00.000Z",
    itemCodes: ["5.02"],
    marketCapBucket: "mid",
    headline: "Departure of directors or principal officers",
    entryPriceUsd: 22,
    entryVolumeShares: 800_000,
    spreadPct: 0.25,
  },
];

function syntheticBars(base: number, days: number): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  let price = base;
  const start = new Date("2026-01-09T00:00:00.000Z").getTime();
  for (let i = 0; i < days; i++) {
    const drift = (i % 5 === 0 ? 0.012 : -0.003) + (i % 3) * 0.002;
    const open = price;
    price = price * (1 + drift);
    bars.push({
      date: new Date(start + i * 86_400_000).toISOString(),
      open,
      high: Math.max(open, price) * 1.01,
      low: Math.min(open, price) * 0.99,
      close: price,
      volume: 1_000_000 + i * 10_000,
    });
  }
  return bars;
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const barsByTicker: Record<string, OhlcvBar[]> = {
    NVDA: syntheticBars(140, 20),
    AMD: syntheticBars(95, 20),
    XYZ: syntheticBars(4, 20),
    ABC: syntheticBars(22, 20),
  };

  const { passed, rejected } = applyEdgarPrefilters(SAMPLE_FILINGS);
  const results = passed
    .map((filing) => {
      const bars = barsByTicker[filing.ticker];
      if (!bars) return null;
      return computeForwardReturns(filing, bars);
    })
    .filter(Boolean);

  const typedResults = results as NonNullable<(typeof results)[number]>[];
  const itemCodeSummary = summarizeByItemCode(typedResults);
  const itemCodePolaritySummary = summarizeByItemCodeAndPolarity(typedResults);
  const holdPeriodSweep = runHoldPeriodSweep(typedResults, [1, 3, 5]);
  const regimeSlices = {
    marketCap: sliceByRegime(typedResults, "market_cap"),
    gapSize: sliceByRegime(typedResults, "gap_size"),
    priorMomentum: sliceByRegime(typedResults, "prior_momentum"),
    realizedVolatility: sliceByRegime(typedResults, "realized_volatility"),
  };
  const ablations = [
    runAblationReport(typedResults, "item_code_only"),
    runAblationReport(typedResults, "item_code_rules"),
    runAblationReport(typedResults, "item_code_llm"),
    runAblationReport(typedResults, "item_code_llm_price"),
  ];
  const calibration = computeConfidenceCalibration(
    typedResults.map((row, index) => ({
      confidence: 0.55 + (index % 4) * 0.1,
      hit5d: row.signedReturns.days5 > 0,
    })),
  );
  const driftFeatures = summarizeDriftFeatures(typedResults);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(OUTPUT_DIR, `edgar-drift-${stamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        researchItemCodes: EDGAR_RESEARCH_ITEM_CODES,
        filingCount: SAMPLE_FILINGS.length,
        prefilterRejected: rejected,
        resultCount: typedResults.length,
        itemCodeSummary,
        itemCodePolaritySummary,
        holdPeriodSweep,
        regimeSlices,
        ablations,
        confidenceCalibration: calibration,
        driftFeatures,
        note: "Sample synthetic data — replace with edgar-historical-ingest output for production runs.",
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outPath}`);
}

main();
