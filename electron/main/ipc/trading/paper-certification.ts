import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import { paperCertificationRunSchema } from "@electron/shared/domain/paper-certification";
import type { AppServices } from "../../services/app-services";
import { handle } from "../handle";

const armSchema = z.object({
  sessionId: z.string().min(1),
  brokerAccountId: z.string().min(1),
});

const runIdSchema = z.object({
  runId: z.string().min(1),
});

export function registerPaperCertificationHandlers(
  services: AppServices,
): void {
  handle(ipcMain, channels.paperCertification.arm, armSchema, async (input) => {
    const svc = services.paperCertification;
    if (!svc) {
      throw new Error("Paper certification service is not configured");
    }
    const run = await svc.arm(input);
    return paperCertificationRunSchema.parse(run);
  });

  handle(
    ipcMain,
    channels.paperCertification.get,
    runIdSchema,
    async ({ runId }) => {
      const svc = services.paperCertification;
      if (!svc) {
        throw new Error("Paper certification service is not configured");
      }
      return paperCertificationRunSchema.parse(svc.get(runId));
    },
  );

  handle(
    ipcMain,
    channels.paperCertification.reconcile,
    runIdSchema,
    async ({ runId }) => {
      const svc = services.paperCertification;
      if (!svc) {
        throw new Error("Paper certification service is not configured");
      }
      const run = await svc.reconcile(runId);
      return paperCertificationRunSchema.parse(run);
    },
  );
}
