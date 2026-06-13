import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { listExperiences } from "../experiences/index";
import { handle } from "./handle";

export function registerExperienceHandlers(): void {
  handle(ipcMain, channels.experiences.list, async () => {
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
