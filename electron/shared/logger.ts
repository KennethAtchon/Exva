import pino from "pino";

const redact = [
  "api_key",
  "apiKey",
  "secret_key",
  "secretKey",
  "authorization",
  "headers.authorization",
  "password",
];

export const logger = pino({
  level: process.env.EXVA_LOG_LEVEL ?? "info",
  redact,
});
