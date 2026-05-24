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

function toLocalDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDayMs(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

function parseLocalDateString(dateString: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = new Date(year, month - 1, day).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function resolveLogDir(): string {
  if (env.logDir && env.logDir.trim().length > 0) return env.logDir;
  return path.join(os.homedir(), ".exva", "logs");
}

function pruneOldLogFiles(logDir: string, retentionDays: number): void {
  const entries = fs.readdirSync(logDir, { withFileTypes: true });
  const todayStartLocalMs = startOfLocalDayMs(new Date());
  const cutoffLocalMs =
    todayStartLocalMs - (retentionDays - 1) * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = new RegExp(
      `^${LOG_PREFIX}(\\d{4}-\\d{2}-\\d{2})${LOG_SUFFIX}$`,
    ).exec(entry.name);
    if (!match) continue;

    const fileDateLocalMs = parseLocalDateString(match[1]);
    if (fileDateLocalMs === null) continue;
    if (fileDateLocalMs < cutoffLocalMs) {
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
    `${LOG_PREFIX}${toLocalDateString(new Date())}${LOG_SUFFIX}`,
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
