import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../../config/env";
import { createLogger } from "../infra/log";

const logger = createLogger("notification-sinks");

const CONFIG_PATH = path.join(
  os.homedir(),
  ".exva",
  "notification-config.json",
);

export type NotificationRouteSeverity = "kill" | "error" | "warn" | "info";

export interface NotificationRoutingConfig {
  /** Push kill/attention immediately to configured sinks. */
  immediateSeverities: NotificationRouteSeverity[];
  /** Local hour (0–23) to flush batched digest messages. */
  digestHourLocal: number;
  ntfyEnabled: boolean;
  telegramEnabled: boolean;
  smtpEnabled: boolean;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface NotificationSinkDeps {
  ntfyTopicUrl?: string | null;
  smtpUrl?: string | null;
  /** Resolve Telegram creds from secrets / env. */
  resolveTelegram?: () => TelegramCredentials | null;
  routing?: Partial<NotificationRoutingConfig>;
}

const DEFAULT_ROUTING: NotificationRoutingConfig = {
  immediateSeverities: ["kill", "error"],
  digestHourLocal: 8,
  ntfyEnabled: true,
  telegramEnabled: true,
  smtpEnabled: true,
};

export function readNotificationRoutingConfig(): NotificationRoutingConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_ROUTING };
    const raw = JSON.parse(
      fs.readFileSync(CONFIG_PATH, "utf8"),
    ) as Partial<NotificationRoutingConfig>;
    return { ...DEFAULT_ROUTING, ...raw };
  } catch {
    return { ...DEFAULT_ROUTING };
  }
}

export function writeNotificationRoutingConfig(
  patch: Partial<NotificationRoutingConfig>,
): NotificationRoutingConfig {
  const next = { ...readNotificationRoutingConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function pushNtfy(
  topicUrl: string,
  title: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(topicUrl, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
      },
      body,
    });
    if (!res.ok) {
      return { ok: false, error: `ntfy HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pushTelegram(
  creds: TelegramCredentials,
  title: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = `*${escapeTelegram(title)}*\n${escapeTelegram(body)}`;
  const url = `https://api.telegram.org/bot${creds.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `telegram HTTP ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function escapeTelegram(value: string): string {
  return value.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

export async function pushSmtp(
  smtpUrl: string,
  title: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!smtpUrl.startsWith("http://") && !smtpUrl.startsWith("https://")) {
    return { ok: false, error: "smtpUrl must be http(s) webhook" };
  }
  try {
    const res = await fetch(smtpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, source: "exva-supervisor" }),
    });
    if (!res.ok) {
      return { ok: false, error: `smtp webhook HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fan-out + digest buffer. Kill/error → immediate push sinks.
 * Info/digest → queued until digestHourLocal.
 */
export class NotificationRouter {
  private digestQueue: Array<{ title: string; body: string; at: string }> = [];
  private lastDigestFlushDay: string | null = null;
  private routing: NotificationRoutingConfig;

  constructor(private readonly deps: NotificationSinkDeps) {
    this.routing = {
      ...DEFAULT_ROUTING,
      ...readNotificationRoutingConfig(),
      ...deps.routing,
    };
  }

  getRouting(): NotificationRoutingConfig {
    return { ...this.routing };
  }

  setRouting(
    patch: Partial<NotificationRoutingConfig>,
  ): NotificationRoutingConfig {
    this.routing = writeNotificationRoutingConfig({
      ...this.routing,
      ...patch,
    });
    return this.getRouting();
  }

  async deliver(input: {
    title: string;
    body: string;
    severity: NotificationRouteSeverity;
    forceImmediate?: boolean;
  }): Promise<{ immediate: boolean; results: Record<string, string> }> {
    const immediate =
      input.forceImmediate === true ||
      this.routing.immediateSeverities.includes(input.severity);

    if (!immediate) {
      this.digestQueue.push({
        title: input.title,
        body: input.body,
        at: new Date().toISOString(),
      });
      this.digestQueue = this.digestQueue.slice(-100);
      return { immediate: false, results: { queued: "digest" } };
    }

    const results = await this.pushAll(input.title, input.body);
    return { immediate: true, results };
  }

  /** Flush digest if local hour matches and we have not flushed today. */
  async maybeFlushDigest(now: Date = new Date()): Promise<boolean> {
    if (this.digestQueue.length === 0) return false;
    if (now.getHours() !== this.routing.digestHourLocal) return false;
    const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (this.lastDigestFlushDay === dayKey) return false;

    const lines = this.digestQueue.map(
      (item) => `• ${item.title}: ${item.body}`,
    );
    const body = lines.join("\n");
    this.digestQueue = [];
    this.lastDigestFlushDay = dayKey;
    await this.pushAll("Exva: daily digest", body);
    logger.info({ count: lines.length }, "notification digest flushed");
    return true;
  }

  async testSink(
    sink: "ntfy" | "telegram" | "smtp",
  ): Promise<{ ok: boolean; error?: string }> {
    const title = `Exva test (${sink})`;
    const body = `Test notification at ${new Date().toISOString()}`;
    if (sink === "ntfy") {
      if (!this.deps.ntfyTopicUrl) {
        return { ok: false, error: "ntfy topic URL not configured" };
      }
      return pushNtfy(this.deps.ntfyTopicUrl, title, body);
    }
    if (sink === "telegram") {
      const creds = this.deps.resolveTelegram?.() ?? null;
      if (!creds) {
        return {
          ok: false,
          error:
            "Telegram bot token/chat id not configured (secretRef notify:telegram)",
        };
      }
      return pushTelegram(creds, title, body);
    }
    if (!this.deps.smtpUrl) {
      return { ok: false, error: "SMTP webhook URL not configured" };
    }
    return pushSmtp(this.deps.smtpUrl, title, body);
  }

  private async pushAll(
    title: string,
    body: string,
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    if (this.routing.ntfyEnabled && this.deps.ntfyTopicUrl) {
      const r = await pushNtfy(this.deps.ntfyTopicUrl, title, body);
      results.ntfy = r.ok ? "ok" : (r.error ?? "failed");
    }
    if (this.routing.telegramEnabled) {
      const creds = this.deps.resolveTelegram?.() ?? null;
      if (creds) {
        const r = await pushTelegram(creds, title, body);
        results.telegram = r.ok ? "ok" : (r.error ?? "failed");
      }
    }
    if (this.routing.smtpEnabled && this.deps.smtpUrl) {
      const r = await pushSmtp(this.deps.smtpUrl, title, body);
      results.smtp = r.ok ? "ok" : (r.error ?? "failed");
    }
    return results;
  }
}

/** Env/secret helpers for Telegram. */
export function parseTelegramSecretJson(
  raw: string | null | undefined,
): TelegramCredentials | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { botToken?: string; chatId?: string };
    if (!parsed.botToken?.trim() || !parsed.chatId?.trim()) return null;
    return {
      botToken: parsed.botToken.trim(),
      chatId: parsed.chatId.trim(),
    };
  } catch {
    return null;
  }
}

export function telegramCredsFromEnv(): TelegramCredentials | null {
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}
