import pino, { type Logger } from "pino";
import { env } from "../config/env";

const redact = [
  "api_key",
  "apiKey",
  "secret_key",
  "secretKey",
  "authorization",
  "headers.authorization",
  "password",
];

const baseLogger = pino({
  level: env.logLevel,
  redact,
});

export function createLogger(scope: string): Logger {
  return baseLogger.child({ scope });
}

export type { Logger };
