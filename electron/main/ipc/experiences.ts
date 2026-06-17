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
      description: experience.description,
      pipelineId: experience.pipelineId,
      defaultPresets: experience.defaultPresets,
      capabilities: experience.capabilities,
    }));
  });
}
