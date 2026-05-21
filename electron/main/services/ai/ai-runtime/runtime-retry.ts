import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";

const logger = createLogger("ai-runtime");

type RetryConfig = {
  timeoutMs: number;
  backoffMs: readonly number[];
  maxRetries: number;
};

const RETRY_CONFIG: RetryConfig = {
  timeoutMs: 60_000,
  backoffMs: [1_000, 2_000, 4_000, 8_000],
  maxRetries: 4,
};

const MAX_PROVIDER_ATTEMPTS = RETRY_CONFIG.maxRetries + 1;

export interface ProviderRetryContext {
  providerType?: string | null;
  modelId?: string | null;
  role?: string | null;
  workerId?: string | null;
  workerName?: string | null;
  sessionId?: string | null;
  cycleId?: string | null;
}

export async function withProviderRetry<T>(
  action: (abortSignal: AbortSignal) => Promise<T>,
  ctx: ProviderRetryContext = {},
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      logger.info(
        {
          ...ctx,
          attempt,
          maxAttempts: MAX_PROVIDER_ATTEMPTS,
          maxRetries: RETRY_CONFIG.maxRetries,
          timeoutMs: RETRY_CONFIG.timeoutMs,
        },
        "provider request attempt",
      );
      const value = await withTimeout(action);
      if (attempt > 1) {
        logger.info(
          {
            ...ctx,
            attempt,
            durationMs: Date.now() - attemptStartedAt,
            totalMs: Date.now() - startedAt,
          },
          "provider request recovered",
        );
      }
      return value;
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error);
      const details = extractProviderErrorDetails(error);
      logger.warn(
        {
          ...ctx,
          attempt,
          maxAttempts: MAX_PROVIDER_ATTEMPTS,
          maxRetries: RETRY_CONFIG.maxRetries,
          retryable,
          willRetry: retryable && attempt < MAX_PROVIDER_ATTEMPTS,
          attemptMs: Date.now() - attemptStartedAt,
          providerErrorName: details.name,
          providerErrorMessage: details.message,
          providerErrorStatus: details.status,
          providerErrorCode: details.code,
          providerErrorCause: details.causeMessage,
          providerErrorCauseChain: details.causeChain,
          providerErrorBody: details.responseBody,
        },
        "provider request attempt failed",
      );
      if (!retryable || attempt >= MAX_PROVIDER_ATTEMPTS) {
        throw wrapProviderError(error, retryable, ctx, attempt);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, providerBackoffMsForAttempt(attempt)),
      );
    }
  }

  // Unreachable but TS-safe
  throw wrapProviderError(lastError, false, ctx, MAX_PROVIDER_ATTEMPTS);
}

async function withTimeout<T>(
  action: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("AI request timed out"));
    }, RETRY_CONFIG.timeoutMs);
  });
  try {
    return await Promise.race([action(controller.signal), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function providerBackoffMsForAttempt(attempt: number): number {
  return (
    RETRY_CONFIG.backoffMs[Math.max(0, attempt - 1)] ??
    RETRY_CONFIG.backoffMs[RETRY_CONFIG.backoffMs.length - 1]
  );
}

function shouldRetry(error: unknown): boolean {
  if (
    error instanceof AppError &&
    (error.code === "MISSING_SECRET" ||
      error.code === "PROVIDER_NOT_CONFIGURED" ||
      error.code === "SEARCH_PROVIDER_REQUIRED")
  ) {
    return false;
  }
  const status = readHttpStatusDeep(error);
  if (status != null) {
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
    if (status >= 400) return false;
  }
  const raw = collectMessageChain(error).join(" | ");
  const lower = raw.toLowerCase();
  if (lower.includes("validation") || lower.includes("schema")) return false;
  if (/\b429\b/.test(raw)) return true;
  if (/\b5\d{2}\b/.test(raw)) return true;
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  ) {
    return true;
  }
  return false;
}

function wrapProviderError(
  error: unknown,
  retryable: boolean,
  ctx: ProviderRetryContext,
  attempts: number,
): AppError {
  if (error instanceof AppError) return error;
  const details = extractProviderErrorDetails(error);
  logger.warn(
    {
      ...ctx,
      attempts,
      retryable,
      providerErrorName: details.name,
      providerErrorMessage: details.message,
      providerErrorStatus: details.status,
      providerErrorCode: details.code,
      providerErrorCause: details.causeMessage,
      providerErrorCauseChain: details.causeChain,
      providerErrorBody: details.responseBody,
    },
    "provider request failed",
  );
  const providerPrefix = ctx.providerType ? `${ctx.providerType} ` : "";
  return new AppError(
    `${providerPrefix}provider unreachable after ${attempts} attempt(s): ${details.summary}`,
    "PROVIDER_UNREACHABLE",
    {
      retryable,
      attempts,
      providerType: ctx.providerType ?? null,
      modelId: ctx.modelId ?? null,
      status: details.status,
      rawMessage: details.message,
      causeMessage: details.causeMessage,
      causeChain: details.causeChain,
      responseBody: details.responseBody,
      providerCode: details.code,
    },
  );
}

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const value =
    record.status ??
    record.statusCode ??
    (record.response as Record<string, unknown> | undefined)?.status;
  return typeof value === "number" ? value : null;
}

function readHttpStatusDeep(error: unknown): number | null {
  for (const node of walkErrorChain(error)) {
    const status = readHttpStatus(node);
    if (status != null) return status;
  }
  return null;
}

function* walkErrorChain(error: unknown): Generator<unknown, void, void> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    yield current;
    if (typeof current !== "object") return;
    current = (current as { cause?: unknown }).cause;
  }
}

function collectMessageChain(error: unknown): string[] {
  const messages: string[] = [];
  for (const node of walkErrorChain(error)) {
    if (node instanceof Error && node.message) messages.push(node.message);
    else if (typeof node === "string") messages.push(node);
  }
  return messages;
}

type ProviderErrorDetails = {
  name: string | null;
  message: string;
  summary: string;
  causeMessage: string | null;
  causeChain: string[];
  responseBody: string | null;
  status: number | null;
  code: string | null;
};

function extractProviderErrorDetails(error: unknown): ProviderErrorDetails {
  const message = error instanceof Error ? error.message : String(error);
  const status = readHttpStatusDeep(error);
  const code = readErrorCodeDeep(error);
  const causeChain = collectMessageChain(error).slice(1); // skip top-level message
  const causeMessage = causeChain[0] ?? null;
  const responseBody = readResponseBodyDeep(error);
  const summaryParts = [
    message,
    causeMessage && causeMessage !== message ? `cause=${causeMessage}` : null,
    responseBody && responseBody !== message && responseBody !== causeMessage
      ? `body=${responseBody}`
      : null,
    status != null ? `status=${status}` : null,
    code ? `code=${code}` : null,
  ].filter(Boolean);
  return {
    name: error instanceof Error ? error.name : null,
    message,
    summary: summaryParts.join(" | "),
    causeMessage,
    causeChain,
    responseBody,
    status,
    code,
  };
}

function readResponseBodyDeep(error: unknown): string | null {
  for (const node of walkErrorChain(error)) {
    const body = readResponseBody(node);
    if (body) return body;
  }
  return null;
}

function readResponseBody(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const candidates = [
    record.responseBody,
    record.body,
    (record.response as Record<string, unknown> | undefined)?.body,
    (record.response as Record<string, unknown> | undefined)?.data,
    record.data,
    record.error,
  ];
  for (const candidate of candidates) {
    const text = stringifyProviderField(candidate);
    if (text) return text;
  }
  return null;
}

function readErrorCodeDeep(error: unknown): string | null {
  for (const node of walkErrorChain(error)) {
    const code = readErrorCode(node);
    if (code) return code;
  }
  return null;
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const value =
    record.code ?? (record.error as Record<string, unknown> | undefined)?.code;
  return typeof value === "string" ? value : null;
}

function stringifyProviderField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
    return safeJson(value);
  }
  return String(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
