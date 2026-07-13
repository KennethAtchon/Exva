import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const tradingTimeframeSchema = z.enum(["15m", "30m", "1h", "4h", "1d", "1w"]);

export function registerOperatorHandlers(services: AppServices): void {
  // ── T1 palette ──────────────────────────────────────────────────────────
  handle(ipcMain, channels.palette.query, async (payload) => {
    const { q, limit } = z
      .object({ q: z.string(), limit: z.number().int().positive().optional() })
      .parse(payload ?? {});
    return services.paletteQuery.query(q, limit);
  });

  // ── T2 backtest lab ─────────────────────────────────────────────────────
  handle(ipcMain, channels.backtest.listStrategies, async () => {
    return { strategies: services.backtestLab.listStrategies() };
  });

  handle(ipcMain, channels.backtest.list, async (payload) => {
    const { experienceId, limit } = z
      .object({
        experienceId: z.string().optional(),
        limit: z.number().int().positive().optional(),
      })
      .parse(payload ?? {});
    return { runs: services.backtestLab.listRuns(experienceId, limit) };
  });

  handle(ipcMain, channels.backtest.get, async (payload) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(payload);
    return { run: services.backtestLab.getRun(id) };
  });

  handle(ipcMain, channels.backtest.run, async (payload) => {
    const input = z
      .object({
        experienceId: z.string().min(1),
        strategyId: z.string().min(1),
        strategyParams: z.record(z.unknown()).optional(),
        symbols: z.array(z.string().min(1)).min(1),
        timeframe: tradingTimeframeSchema,
        windowStart: z.string().min(1),
        windowEnd: z.string().min(1),
        folds: z.number().int().positive().default(3),
        foldConfig: z
          .object({ purge: z.number().int().nonnegative().optional() })
          .optional(),
        costs: z
          .object({
            spreadBps: z.number().optional(),
            feeBps: z.number().optional(),
            slippageBps: z.number().optional(),
          })
          .optional(),
        exitPolicy: z
          .object({
            stopLossPct: z.number().optional(),
            takeProfitPct: z.number().optional(),
            maxHoldBars: z.number().int().optional(),
          })
          .optional(),
        instrumentClass: z.string().optional(),
      })
      .parse(payload);
    return services.backtestLab.run(input);
  });

  handle(ipcMain, channels.backtest.compare, async (payload) => {
    const { runIds } = z
      .object({ runIds: z.array(z.string().min(1)).min(2) })
      .parse(payload);
    return services.backtestLab.compare(runIds);
  });

  handle(ipcMain, channels.backtest.sweep, async (payload) => {
    const input = z
      .object({
        experienceId: z.string().min(1),
        strategyId: z.string().min(1),
        strategyParams: z.record(z.unknown()).optional(),
        symbols: z.array(z.string().min(1)).min(1),
        timeframe: tradingTimeframeSchema,
        windowStart: z.string().min(1),
        windowEnd: z.string().min(1),
        folds: z.number().int().positive().default(3),
        paramKey: z.string().min(1),
        values: z.array(z.number()).min(2),
        costs: z
          .object({
            spreadBps: z.number().optional(),
            feeBps: z.number().optional(),
            slippageBps: z.number().optional(),
          })
          .optional(),
        exitPolicy: z
          .object({
            stopLossPct: z.number().optional(),
            takeProfitPct: z.number().optional(),
            maxHoldBars: z.number().int().optional(),
          })
          .optional(),
        instrumentClass: z.string().optional(),
      })
      .parse(payload);
    return services.backtestLab.sweep(input);
  });

  // ── T3 data doctor ──────────────────────────────────────────────────────
  handle(ipcMain, channels.dataDoctor.coverage, async () => {
    return { cells: services.dataDoctor.coverageMatrix() };
  });

  handle(ipcMain, channels.dataDoctor.gaps, async (payload) => {
    const { symbol, timeframe } = z
      .object({ symbol: z.string().min(1), timeframe: z.string().min(1) })
      .parse(payload);
    return { gaps: services.dataDoctor.detectGaps(symbol, timeframe) };
  });

  handle(ipcMain, channels.dataDoctor.backfill, async (payload) => {
    const input = z
      .object({
        symbol: z.string().min(1),
        timeframe: tradingTimeframeSchema,
        instrumentClass: z.string().optional(),
        provider: z.enum(["alpaca", "tradier", "kraken", "manual"]).optional(),
        barCount: z.number().int().positive().optional(),
      })
      .parse(payload);
    return services.dataDoctor.backfill(input);
  });

  handle(ipcMain, channels.dataDoctor.providerHealth, async () => {
    return { providers: services.dataDoctor.providerHealth() };
  });

  handle(ipcMain, channels.dataDoctor.setProviderEnabled, async (payload) => {
    const { provider, enabled } = z
      .object({ provider: z.string().min(1), enabled: z.boolean() })
      .parse(payload);
    services.dataDoctor.setProviderEnabled(provider, enabled);
    return { ok: true as const };
  });

  handle(ipcMain, channels.dataDoctor.runNightlyGapCheck, async () => {
    return services.dataDoctor.runNightlyGapCheck();
  });

  // ── T4 briefing ─────────────────────────────────────────────────────────
  handle(ipcMain, channels.briefing.latest, async () => {
    return { briefing: services.morningBriefing.latest() };
  });

  handle(ipcMain, channels.briefing.list, async (payload) => {
    const { limit } = z
      .object({ limit: z.number().int().positive().optional() })
      .parse(payload ?? {});
    return { briefings: services.morningBriefing.list(limit) };
  });

  handle(ipcMain, channels.briefing.get, async (payload) => {
    const { date } = z.object({ date: z.string().min(1) }).parse(payload);
    return { briefing: services.morningBriefing.get(date) };
  });

  handle(ipcMain, channels.briefing.assemble, async (payload) => {
    const { date } = z
      .object({ date: z.string().optional() })
      .parse(payload ?? {});
    const briefing = await services.morningBriefing.assemble(date);
    return { briefing };
  });

  // ── T5 equity ───────────────────────────────────────────────────────────
  handle(ipcMain, channels.equity.curve, async (payload) => {
    const { range } = z
      .object({ range: z.enum(["1W", "1M", "3M", "all"]).optional() })
      .parse(payload ?? {});
    return services.equitySnapshots.curve(range ?? "1M");
  });

  handle(ipcMain, channels.equity.attribution, async (payload) => {
    const { range } = z
      .object({ range: z.enum(["1W", "1M", "3M", "all"]).optional() })
      .parse(payload ?? {});
    return services.equitySnapshots.attribution(range ?? "1M");
  });

  handle(ipcMain, channels.equity.snapshotNow, async () => {
    return { snapshot: services.equitySnapshots.takeSnapshot() };
  });

  // ── T6 what-if ──────────────────────────────────────────────────────────
  handle(ipcMain, channels.whatIf.run, async (payload) => {
    const input = z
      .object({
        tradeId: z.string().min(1),
        params: z
          .object({
            zScoreEntry: z.number().optional(),
            maxPositionUsd: z.number().optional(),
            stopLossPct: z.number().optional(),
            strategyId: z.string().optional(),
            strategyParams: z.record(z.unknown()).optional(),
          })
          .default({}),
        save: z.boolean().optional(),
        experienceId: z.string().optional(),
      })
      .parse(payload);
    return services.whatIfReplay.run(input.tradeId, input.params, {
      save: input.save,
      experienceId: input.experienceId,
    });
  });

  // ── T7 kill switch ──────────────────────────────────────────────────────
  handle(ipcMain, channels.killSwitch.pauseAll, async () => {
    return services.killSwitch.pauseAll();
  });

  handle(ipcMain, channels.killSwitch.killSession, async (payload) => {
    const { sessionId } = z
      .object({ sessionId: z.string().min(1) })
      .parse(payload);
    return services.killSwitch.killSession(sessionId);
  });

  handle(ipcMain, channels.killSwitch.gauges, async () => {
    return { gauges: services.killSwitch.gauges() };
  });

  handle(ipcMain, channels.killSwitch.flattenAll, async (payload) => {
    const { confirmation } = z
      .object({ confirmation: z.string() })
      .parse(payload);
    return services.killSwitch.flattenAll(confirmation);
  });
}
