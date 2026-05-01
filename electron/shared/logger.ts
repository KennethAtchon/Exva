import pino from "pino";
import { env } from "../main/config/env";

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
  level: env.logLevel,
  redact,
});
