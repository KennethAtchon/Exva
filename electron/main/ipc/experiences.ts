import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { listExperiences } from "../experiences/index";
import { handle } from "./handle";
import type { AppServices } from "../services/app-services";

export function registerExperienceHandlers(services: AppServices): void {
  handle(ipcMain, channels.experiences.list, async () => {
    services.signals.ensureAllExperienceSignalSources();
    return listExperiences().map((experience) => ({
      id: experience.id,
      displayName: experience.displayName,
      signalSourceType: experience.signalSource.type,
      pipelineId: experience.pipeline.id,
      presets: experience.presets,
      capabilities: experience.capabilities,
    }));
  });
}
