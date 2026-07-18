import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";
import { ipcNoPayloadSchema, ipcPayloadUnknownSchema } from "./payload-schemas";

const experienceIdSchema = z.object({
  experienceId: z.string(),
});

export function registerAnalyticsHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.experiences.listScorecards,
    ipcNoPayloadSchema,
    async () => {
      const scorecards = services.experienceScorecard.generateAll();
      return { scorecards };
    },
  );

  handle(
    ipcMain,
    channels.experiences.getScorecard,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { experienceId } = experienceIdSchema.parse(payload);
      const scorecard =
        services.experienceScorecard.generateForExperience(experienceId);
      return { scorecard };
    },
  );
}
