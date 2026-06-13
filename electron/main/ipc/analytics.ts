import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const experienceIdSchema = z.object({
  experienceId: z.string(),
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
}
