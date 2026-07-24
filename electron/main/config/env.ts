import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

function resolveDotEnvCandidates(): string[] {
  const moduleDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

  const roots = new Set<string>([
    process.cwd(),
    path.resolve(moduleDir, "../../.."),
  ]);
  let dir = moduleDir;
  for (let depth = 0; depth < 6; depth += 1) {
    roots.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return [...roots].map((root) => path.join(root, ".env"));
}

/** Load repo `.env` in dev; skip in tests and when vars are already exported. */
function bootstrapDotEnv(): void {
  if (process.env.NODE_ENV === "test") return;

  for (const envPath of resolveDotEnvCandidates()) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, quiet: true });
    return;
  }
}

bootstrapDotEnv();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  EXVA_LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug", "trace"])
    .default("info"),
  EXVA_LOG_DIR: z.string().optional(),
  EXVA_DB_PATH: z.string().optional(),
  EXVA_DB_REBUILD_FROM_SCRATCH: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  EXVA_DEV_BYPASS_KEYCHAIN: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  EXVA_PROMPTS_DIR_OVERRIDE: z.string().optional(),
  EXVA_UTILITY_PROCESS_RUNTIMES: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /** Default on (missing/undefined !== "false") so tests keep mock rehearsal. */
  EXVA_ENABLE_MOCK_REHEARSAL: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  OPEN_ROUTER_KEY: z.string().optional(),
  OPEN_ROUTER_MODEL: z.string().optional(),
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  EXVA_SEC_CONTACT: z.string().email().optional(),
  EXVA_APP_VERSION: z.string().min(1).optional(),
  /** ntfy.sh topic URL for supervisor push (e.g. https://ntfy.sh/exva-ken). */
  EXVA_NTFY_URL: z.string().optional(),
  EXVA_NTFY_TOPIC_URL: z.string().optional(),
  /** Optional SMTP sink for supervisor digests (mailto://user:pass@host:port). */
  EXVA_SMTP_URL: z.string().optional(),
  /** Telegram bot token for supervisor push (alternate: Keychain notify:telegram). */
  EXVA_TELEGRAM_BOT_TOKEN: z.string().optional(),
  EXVA_TELEGRAM_CHAT_ID: z.string().optional(),
  /** Backup directory override (default ~/.exva/backups). */
  EXVA_DB_BACKUP_DIR: z.string().optional(),
  /** Headless main-process mode (no BrowserWindow). */
  EXVA_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  /** Opt-in LLM period autopsy on nightly job (default preview-only). */
  EXVA_PERIOD_AUTOPSY_RUN: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /** Allow unattended period autopsy above $5 estimate when RUN is also set. */
  EXVA_PERIOD_AUTOPSY_ALLOW_HIGH_COST: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

function normalizeOptionalSecret(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }

  return Object.freeze({
    isDev: parsed.data.NODE_ENV === "development",
    isTest: parsed.data.NODE_ENV === "test",
    isProd: parsed.data.NODE_ENV === "production",
    logLevel: parsed.data.EXVA_LOG_LEVEL,
    logDir: parsed.data.EXVA_LOG_DIR,
    dbPath: parsed.data.EXVA_DB_PATH,
    dbRebuildFromScratch: parsed.data.EXVA_DB_REBUILD_FROM_SCRATCH ?? false,
    devBypassKeychain: parsed.data.EXVA_DEV_BYPASS_KEYCHAIN ?? false,
    promptsDirOverride: parsed.data.EXVA_PROMPTS_DIR_OVERRIDE,
    utilityProcessRuntimes: parsed.data.EXVA_UTILITY_PROCESS_RUNTIMES ?? false,
    enableMockRehearsal: parsed.data.EXVA_ENABLE_MOCK_REHEARSAL ?? true,
    openRouterKey: normalizeOptionalSecret(parsed.data.OPEN_ROUTER_KEY),
    openRouterModel: normalizeOptionalSecret(parsed.data.OPEN_ROUTER_MODEL),
    alpacaApiKey: normalizeOptionalSecret(parsed.data.ALPACA_API_KEY),
    alpacaSecretKey: normalizeOptionalSecret(parsed.data.ALPACA_SECRET_KEY),
    secContact:
      normalizeOptionalSecret(parsed.data.EXVA_SEC_CONTACT) ??
      "support@exva.app",
    appVersion:
      normalizeOptionalSecret(parsed.data.EXVA_APP_VERSION) ?? "0.1.0",
    ntfyTopicUrl:
      normalizeOptionalSecret(parsed.data.EXVA_NTFY_URL) ??
      normalizeOptionalSecret(parsed.data.EXVA_NTFY_TOPIC_URL),
    smtpUrl: normalizeOptionalSecret(parsed.data.EXVA_SMTP_URL),
    telegramBotToken: normalizeOptionalSecret(
      parsed.data.EXVA_TELEGRAM_BOT_TOKEN,
    ),
    telegramChatId: normalizeOptionalSecret(parsed.data.EXVA_TELEGRAM_CHAT_ID),
    dbBackupDir: parsed.data.EXVA_DB_BACKUP_DIR,
    headless: parsed.data.EXVA_HEADLESS ?? false,
    periodAutopsyRun: parsed.data.EXVA_PERIOD_AUTOPSY_RUN ?? false,
    periodAutopsyAllowHighCost:
      parsed.data.EXVA_PERIOD_AUTOPSY_ALLOW_HIGH_COST ?? false,
  });
}

export const env = loadEnv();
