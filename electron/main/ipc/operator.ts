import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";
import { ipcNoPayloadSchema, ipcPayloadUnknownSchema } from "./payload-schemas";

const tradingTimeframeSchema = z.enum(["15m", "30m", "1h", "4h", "1d", "1w"]);

export function registerOperatorHandlers(services: AppServices): void {
  // ── T1 palette ──────────────────────────────────────────────────────────
  handle(
    ipcMain,
    channels.palette.query,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { q, limit } = z
        .object({
          q: z.string(),
          limit: z.number().int().positive().optional(),
        })
        .parse(payload ?? {});
      return services.paletteQuery.query(q, limit);
    },
  );

  // ── T2 backtest lab ─────────────────────────────────────────────────────
  handle(
    ipcMain,
    channels.backtest.listStrategies,
    ipcNoPayloadSchema,
    async () => {
      return { strategies: services.backtestLab.listStrategies() };
    },
  );

  handle(
    ipcMain,
    channels.backtest.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { experienceId, limit } = z
        .object({
          experienceId: z.string().optional(),
          limit: z.number().int().positive().optional(),
        })
        .parse(payload ?? {});
      return { runs: services.backtestLab.listRuns(experienceId, limit) };
    },
  );

  handle(
    ipcMain,
    channels.backtest.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(payload);
      return { run: services.backtestLab.getRun(id) };
    },
  );

  handle(
    ipcMain,
    channels.backtest.run,
    ipcPayloadUnknownSchema,
    async (payload) => {
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
    },
  );

  handle(
    ipcMain,
    channels.backtest.compare,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { runIds } = z
        .object({ runIds: z.array(z.string().min(1)).min(2) })
        .parse(payload);
      return services.backtestLab.compare(runIds);
    },
  );

  handle(
    ipcMain,
    channels.backtest.sweep,
    ipcPayloadUnknownSchema,
    async (payload) => {
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
    },
  );

  // ── T3 data doctor ──────────────────────────────────────────────────────
  handle(
    ipcMain,
    channels.dataDoctor.coverage,
    ipcNoPayloadSchema,
    async () => {
      return { cells: services.dataDoctor.coverageMatrix() };
    },
  );

  handle(
    ipcMain,
    channels.dataDoctor.gaps,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { symbol, timeframe } = z
        .object({ symbol: z.string().min(1), timeframe: z.string().min(1) })
        .parse(payload);
      return { gaps: services.dataDoctor.detectGaps(symbol, timeframe) };
    },
  );

  handle(
    ipcMain,
    channels.dataDoctor.backfill,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = z
        .object({
          symbol: z.string().min(1),
          timeframe: tradingTimeframeSchema,
          instrumentClass: z.string().optional(),
          provider: z
            .enum(["alpaca", "tradier", "kraken", "manual"])
            .optional(),
          barCount: z.number().int().positive().optional(),
        })
        .parse(payload);
      return services.dataDoctor.backfill(input);
    },
  );

  handle(
    ipcMain,
    channels.dataDoctor.providerHealth,
    ipcNoPayloadSchema,
    async () => {
      return { providers: services.dataDoctor.providerHealth() };
    },
  );

  handle(
    ipcMain,
    channels.dataDoctor.setProviderEnabled,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { provider, enabled } = z
        .object({ provider: z.string().min(1), enabled: z.boolean() })
        .parse(payload);
      services.dataDoctor.setProviderEnabled(provider, enabled);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.dataDoctor.runNightlyGapCheck,
    ipcNoPayloadSchema,
    async () => {
      return services.dataDoctor.runNightlyGapCheck();
    },
  );

  // ── T4 briefing ─────────────────────────────────────────────────────────
  handle(ipcMain, channels.briefing.latest, ipcNoPayloadSchema, async () => {
    return { briefing: services.morningBriefing.latest() };
  });

  handle(
    ipcMain,
    channels.briefing.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { limit } = z
        .object({ limit: z.number().int().positive().optional() })
        .parse(payload ?? {});
      return { briefings: services.morningBriefing.list(limit) };
    },
  );

  handle(
    ipcMain,
    channels.briefing.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { date } = z.object({ date: z.string().min(1) }).parse(payload);
      return { briefing: services.morningBriefing.get(date) };
    },
  );

  handle(
    ipcMain,
    channels.briefing.assemble,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { date } = z
        .object({ date: z.string().optional() })
        .parse(payload ?? {});
      const briefing = await services.morningBriefing.assemble(date);
      return { briefing };
    },
  );

  // ── T5 equity ───────────────────────────────────────────────────────────
  handle(
    ipcMain,
    channels.equity.curve,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { range } = z
        .object({ range: z.enum(["1W", "1M", "3M", "all"]).optional() })
        .parse(payload ?? {});
      return services.equitySnapshots.curve(range ?? "1M");
    },
  );

  handle(
    ipcMain,
    channels.equity.attribution,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { range } = z
        .object({ range: z.enum(["1W", "1M", "3M", "all"]).optional() })
        .parse(payload ?? {});
      return services.equitySnapshots.attribution(range ?? "1M");
    },
  );

  handle(ipcMain, channels.equity.snapshotNow, ipcNoPayloadSchema, async () => {
    return { snapshot: services.equitySnapshots.takeSnapshot() };
  });

  // ── T6 what-if ──────────────────────────────────────────────────────────
  handle(
    ipcMain,
    channels.whatIf.run,
    ipcPayloadUnknownSchema,
    async (payload) => {
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
    },
  );

  // ── T7 kill switch ──────────────────────────────────────────────────────
  const killSessionSchema = z.object({ sessionId: z.string().min(1) });
  const flattenAllSchema = z.object({ confirmation: z.string() });

  handle(
    ipcMain,
    channels.killSwitch.pauseAll,
    ipcNoPayloadSchema,
    async () => {
      return services.killSwitch.pauseAll();
    },
  );

  handle(
    ipcMain,
    channels.killSwitch.killSession,
    killSessionSchema,
    async ({ sessionId }) => {
      return services.killSwitch.killSession(sessionId);
    },
  );

  handle(ipcMain, channels.killSwitch.gauges, ipcNoPayloadSchema, async () => {
    return { gauges: services.killSwitch.gauges() };
  });

  handle(
    ipcMain,
    channels.killSwitch.flattenAll,
    flattenAllSchema,
    async ({ confirmation }) => {
      return services.killSwitch.flattenAll(confirmation);
    },
  );
}
