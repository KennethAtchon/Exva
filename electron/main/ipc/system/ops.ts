import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { handle } from "../handle";
import {
  backupSqliteDb,
  readLastBackupMeta,
  resolveAppDbPath,
} from "../../services/infra/db-backup";
import {
  telegramCredsFromEnv,
  writeNotificationRoutingConfig,
  type NotificationRoutingConfig,
} from "../../services/supervisor/notification-sinks";
import type { SupervisorAlarmKind } from "../../services/supervisor/supervisor-service";
import { isHeadlessMode, readInstanceLock } from "../../instance-lock";
import { env } from "../../config/env";

const alarmKindSchema = z.enum([
  "heartbeat_stale",
  "consecutive_skip",
  "data_freshness",
  "daily_loss",
  "drawdown",
  "drift",
  "ai_spend",
  "websocket_feed_degraded",
  "backup_failed",
]);

const routingPatchSchema = z
  .object({
    immediateSeverities: z
      .array(z.enum(["kill", "error", "warn", "info"]))
      .optional(),
    digestHourLocal: z.number().int().min(0).max(23).optional(),
    ntfyEnabled: z.boolean().optional(),
    telegramEnabled: z.boolean().optional(),
    smtpEnabled: z.boolean().optional(),
  })
  .strict();

export function registerOpsHandlers(services: AppServices): void {
  handle(ipcMain, channels.ops.getBackupStatus, async () => {
    const meta = readLastBackupMeta();
    return {
      lastBackup: meta,
      dbPath: services.db.dbPath || resolveAppDbPath(),
      headless: isHeadlessMode(),
      instanceLock: readInstanceLock(),
    };
  });

  handle(ipcMain, channels.ops.runBackupNow, async () => {
    const result = backupSqliteDb({
      sourcePath: services.db.dbPath,
      trigger: "manual",
    });
    if (!result.ok) {
      await services.supervisor.raiseBackupFailed(
        result.error ?? "manual backup failed",
      );
    }
    return result;
  });

  handle(ipcMain, channels.ops.getNotificationRouting, async () => {
    const hasTelegramSecret = await services.secrets.has("notify:telegram");
    return {
      routing: services.supervisor.getRouting(),
      ntfyConfigured: Boolean(env.ntfyTopicUrl),
      telegramConfigured: hasTelegramSecret || Boolean(telegramCredsFromEnv()),
      smtpConfigured: Boolean(env.smtpUrl),
    };
  });

  handle(ipcMain, channels.ops.updateNotificationRouting, async (payload) => {
    const patch = routingPatchSchema.parse(
      payload,
    ) as Partial<NotificationRoutingConfig>;
    writeNotificationRoutingConfig(patch);
    const routing = services.supervisor.setRouting(patch);
    return { routing };
  });

  handle(ipcMain, channels.ops.testNotificationSink, async (payload) => {
    const { sink } = z
      .object({ sink: z.enum(["ntfy", "telegram", "smtp"]) })
      .parse(payload);
    return services.supervisor.router.testSink(sink);
  });

  handle(ipcMain, channels.ops.setTelegramSecret, async (payload) => {
    const { botToken, chatId } = z
      .object({
        botToken: z.string().min(1),
        chatId: z.string().min(1),
      })
      .parse(payload);
    await services.secrets.set(
      "notify:telegram",
      JSON.stringify({ botToken, chatId }),
    );
    return { ok: true as const };
  });

  handle(ipcMain, channels.ops.clearTelegramSecret, async () => {
    await services.secrets.delete("notify:telegram");
    return { ok: true as const };
  });

  handle(ipcMain, channels.ops.listAlarms, async () => {
    return { alarms: services.supervisor.getAlarms() };
  });

  handle(ipcMain, channels.ops.triggerTestAlarm, async (payload) => {
    const { kind, sessionId } = z
      .object({
        kind: alarmKindSchema,
        sessionId: z.string().nullable().optional(),
      })
      .parse(payload);
    const alarm = await services.supervisor.triggerTestAlarm(
      kind as SupervisorAlarmKind,
      sessionId ?? "test-session",
    );
    return { alarm };
  });
}
