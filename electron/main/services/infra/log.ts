import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino, { type Logger } from "pino";
import { env } from "../../config/env";
import { telemetryLogFields } from "./telemetry-context";

const redact = [
  "api_key",
  "apiKey",
  "apiSecret",
  "api_secret",
  "secret_key",
  "secretKey",
  "secret",
  "privateKey",
  "private_key",
  "privateKeyPem",
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

function logFilePathFor(logDir: string, dateString: string): string {
  return path.join(logDir, `${LOG_PREFIX}${dateString}${LOG_SUFFIX}`);
}

/**
 * The destination filename used to be computed once at process boot, so a
 * long-running process kept writing to the boot day's file forever — the
 * 7-day retention prune never applied to the active file (secondary problem
 * 8, docs/reviews/2026-07-19-overnight-stress-session-review.md). This
 * re-opens the underlying file destination whenever the local date changes.
 */
export function createRotatingFileStream(logDir: string): {
  write(chunk: string): void;
} {
  let currentDateString = toLocalDateString(new Date());
  let dest = pino.destination({
    dest: logFilePathFor(logDir, currentDateString),
    mkdir: true,
    sync: false,
  });

  return {
    write(chunk: string): void {
      const todayDateString = toLocalDateString(new Date());
      if (todayDateString !== currentDateString) {
        currentDateString = todayDateString;
        dest.end();
        dest = pino.destination({
          dest: logFilePathFor(logDir, currentDateString),
          mkdir: true,
          sync: false,
        });
        pruneOldLogFiles(logDir, LOG_RETENTION_DAYS);
      }
      dest.write(chunk);
    },
  };
}

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

function createBaseLogger(): Logger {
  const logDir = resolveLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  pruneOldLogFiles(logDir, LOG_RETENTION_DAYS);

  const streams = pino.multistream([
    { stream: process.stdout, level: "trace" },
    {
      stream: createRotatingFileStream(logDir),
      level: "trace",
    },
  ]);

  return pino(
    {
      level: env.logLevel,
      redact,
      mixin: telemetryLogFields,
    },
    streams,
  );
}

const baseLogger = createBaseLogger();
const scopedLoggers = new Map<string, Logger>();
let runtimeLogLevel: LogLevel = env.logLevel;

export function createLogger(scope: string): Logger {
  const existing = scopedLoggers.get(scope);
  if (existing) return existing;
  const child = baseLogger.child({ scope }, { level: runtimeLogLevel });
  scopedLoggers.set(scope, child);
  return child;
}

export function setRuntimeLogLevel(level: LogLevel): void {
  runtimeLogLevel = level;
  baseLogger.level = level;
  for (const logger of scopedLoggers.values()) logger.level = level;
}

export function getRuntimeLogLevel(): LogLevel {
  return runtimeLogLevel;
}

export function resetRuntimeLogLevel(): void {
  setRuntimeLogLevel(env.logLevel);
}

export type { Logger };
