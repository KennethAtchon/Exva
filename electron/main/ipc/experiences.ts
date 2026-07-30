import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { listExperiences } from "../experiences/index";
import { handle } from "./handle";
import { ipcNoPayloadSchema } from "./payload-schemas";
import type { AppServices } from "../services/app-services";

export function registerExperienceHandlers(services: AppServices): void {
  void services;
  handle(ipcMain, channels.experiences.list, ipcNoPayloadSchema, async () => {
    return listExperiences().map((experience) => ({
      id: experience.id,
      displayName: experience.displayName,
      description: experience.description,
      pipelineId: experience.pipelineId,
      defaultPresets: experience.defaultPresets,
      capabilities: experience.capabilities,
      acceptsScanHit: experience.acceptsScanHit ?? false,
      supportState: experience.supportState ?? "available",
      blockerCode: experience.blockerCode ?? null,
      blockerMessage: experience.blockerMessage ?? null,
    }));
  });
}
