import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { handle } from "../handle";

const cycleFixtureRequestSchema = z.object({
  sessionId: z.string(),
  cycleId: z.string(),
});

const scorecardRequestSchema = z.object({
  sessionId: z.string(),
});

export function registerReplayHandlers(services: AppServices): void {
  handle(ipcMain, channels.session.buildCycleFixture, async (payload) => {
    const { cycleId } = cycleFixtureRequestSchema.parse(payload);
    const fixture = services.cycleReplay.buildFixture(cycleId);
    return { fixture };
  });

  handle(ipcMain, channels.session.saveCycleFixture, async (payload) => {
    const { cycleId } = cycleFixtureRequestSchema.parse(payload);
    const fixture = services.cycleReplay.buildFixture(cycleId);
    if (!fixture) {
      return { filePath: null };
    }
    const filePath = services.cycleReplay.saveFixture(fixture);
    return { filePath };
  });

  handle(ipcMain, channels.session.getPaperScorecard, async (payload) => {
    const { sessionId } = scorecardRequestSchema.parse(payload);
    const scorecard = services.paperScorecard.generate(sessionId);
    return { scorecard };
  });
}
