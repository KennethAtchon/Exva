import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino, { type Logger } from "pino";
import { env } from "../../config/env";

const redact = [
  "api_key",
  "apiKey",
  "secret_key",
  "secretKey",
  "authorization",
  "headers.authorization",
  "password",
];

const LOG_PREFIX = "exva-";
const LOG_SUFFIX = ".log";
const LOG_RETENTION_DAYS = 7;

function toIsoDateUtc(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveLogDir(): string {
  if (env.logDir && env.logDir.trim().length > 0) return env.logDir;
  return path.join(os.homedir(), ".exva", "logs");
}

function pruneOldLogFiles(logDir: string, retentionDays: number): void {
  const entries = fs.readdirSync(logDir, { withFileTypes: true });
  const today = new Date();
  const todayStartUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const cutoffUtcMs =
    todayStartUtcMs - (retentionDays - 1) * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = new RegExp(
      `^${LOG_PREFIX}(\\d{4}-\\d{2}-\\d{2})${LOG_SUFFIX}$`,
    ).exec(entry.name);
    if (!match) continue;

    const fileDateUtcMs = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(fileDateUtcMs)) continue;
    if (fileDateUtcMs < cutoffUtcMs) {
      fs.rmSync(path.join(logDir, entry.name), { force: true });
    }
  }
}

function createBaseLogger(): Logger {
  const logDir = resolveLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  pruneOldLogFiles(logDir, LOG_RETENTION_DAYS);

  const logFilePath = path.join(
    logDir,
    `${LOG_PREFIX}${toIsoDateUtc(new Date())}${LOG_SUFFIX}`,
  );
  const streams = pino.multistream([
    { stream: process.stdout, level: env.logLevel },
    {
      stream: pino.destination({ dest: logFilePath, mkdir: true, sync: false }),
      level: env.logLevel,
    },
  ]);

  return pino(
    {
      level: env.logLevel,
      redact,
    },
    streams,
  );
}

const baseLogger = createBaseLogger();

export function createLogger(scope: string): Logger {
  return baseLogger.child({ scope });
}

export type { Logger };
