import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  EXVA_LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  EXVA_DB_PATH: z.string().optional(),
  EXVA_DEV_BYPASS_KEYCHAIN: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  EXVA_PROMPTS_DIR_OVERRIDE: z.string().optional(),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }

  return Object.freeze({
    isDev: parsed.data.NODE_ENV === "development",
    isTest: parsed.data.NODE_ENV === "test",
    isProd: parsed.data.NODE_ENV === "production",
    logLevel: parsed.data.EXVA_LOG_LEVEL,
    dbPath: parsed.data.EXVA_DB_PATH,
    devBypassKeychain: parsed.data.EXVA_DEV_BYPASS_KEYCHAIN ?? false,
    promptsDirOverride: parsed.data.EXVA_PROMPTS_DIR_OVERRIDE,
  });
}

export const env = loadEnv();

export type Env = typeof env;
