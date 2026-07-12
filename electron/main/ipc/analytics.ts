import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const experienceIdSchema = z.object({
  experienceId: z.string(),
});

const recordExperimentSchema = z.object({
  id: z.string(),
  experienceId: z.string(),
  configHash: z.string(),
  datasetWindowStart: z.string().nullable().optional(),
  datasetWindowEnd: z.string().nullable().optional(),
  metrics: z.record(z.unknown()),
  notes: z.string().default(""),
  verdict: z.enum(["promising", "reject", "inconclusive"]),
});

const compareExperimentsSchema = z.object({
  experimentIdA: z.string(),
  experimentIdB: z.string(),
});

export function registerAnalyticsHandlers(services: AppServices): void {
  handle(ipcMain, channels.experiences.listScorecards, async () => {
    const scorecards = services.experienceScorecard.generateAll();
    return { scorecards };
  });

  handle(ipcMain, channels.experiences.getScorecard, async (payload) => {
    const { experienceId } = experienceIdSchema.parse(payload);
    const scorecard =
      services.experienceScorecard.generateForExperience(experienceId);
    return { scorecard };
  });

  handle(ipcMain, channels.experiences.listExperiments, async (payload) => {
    const { experienceId } = experienceIdSchema.parse(payload);
    const experiments =
      services.repos.experienceExperiments.listByExperience(experienceId);
    return { experiments };
  });

  handle(ipcMain, channels.experiences.recordExperiment, async (payload) => {
    const input = recordExperimentSchema.parse(payload);
    const experiment = services.repos.experienceExperiments.insert({
      ...input,
      datasetWindowStart: input.datasetWindowStart ?? null,
      datasetWindowEnd: input.datasetWindowEnd ?? null,
    });
    return { experiment };
  });

  handle(ipcMain, channels.experiences.compareExperiments, async (payload) => {
    const { experimentIdA, experimentIdB } =
      compareExperimentsSchema.parse(payload);
    const comparison = services.repos.experienceExperiments.compare(
      experimentIdA,
      experimentIdB,
    );
    return { comparison };
  });

  handle(ipcMain, channels.experiences.getResearchSummary, async () => {
    const summary = services.researchSummary.generateSummary({});
    return { summary };
  });

  handle(
    ipcMain,
    channels.experiences.approveLadderUpgrade,
    async (payload) => {
      const { experienceId } = experienceIdSchema.parse(payload);
      const state = services.approveLadderUpgrade(experienceId);
      return { state };
    },
  );
}
