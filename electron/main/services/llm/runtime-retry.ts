import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../infra/log";

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

export interface LLMRetryContext {
  providerType?: string | null;
  modelId?: string | null;
  role?: string | null;
  workerId?: string | null;
  workerName?: string | null;
  sessionId?: string | null;
  cycleId?: string | null;
}

export interface LLMRetryHooks<T> {
  onAttempt?: (input: {
    attempt: number;
    durationMs: number;
    status: "ok" | "error";
    retryable: boolean;
    value?: T;
  }) => void;
}

export interface LLMRetryOptions {
  timeoutMs?: number;
}

export async function withLLMRetry<T>(
  action: (abortSignal: AbortSignal) => Promise<T>,
  ctx: LLMRetryContext = {},
  hooks: LLMRetryHooks<T> = {},
  options: LLMRetryOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? RETRY_CONFIG.timeoutMs;
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
          timeoutMs,
        },
        "provider request attempt",
      );
      const value = await withTimeout(action, timeoutMs);
      notifyAttemptHook(hooks, {
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        status: "ok",
        retryable: false,
        value,
      });
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
      const details = safeProviderErrorDetails(error);
      notifyAttemptHook(hooks, {
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        status: "error",
        retryable,
      });
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
          providerErrorKind: details.kind,
          providerErrorStatus: details.status,
          providerErrorCode: details.code,
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

function notifyAttemptHook<T>(
  hooks: LLMRetryHooks<T>,
  input: Parameters<NonNullable<LLMRetryHooks<T>["onAttempt"]>>[0],
): void {
  try {
    hooks.onAttempt?.(input);
  } catch {
    logger.error(
      {
        eventName: "provider.attempt.persistence_failed",
        attempt: input.attempt,
        status: input.status,
      },
      "provider attempt telemetry failed",
    );
  }
}

async function withTimeout<T>(
  action: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("AI request timed out"));
    }, timeoutMs);
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
  ctx: LLMRetryContext,
  attempts: number,
): AppError {
  if (error instanceof AppError) return error;
  const details = safeProviderErrorDetails(error);
  logger.warn(
    {
      ...ctx,
      attempts,
      retryable,
      providerErrorName: details.name,
      providerErrorKind: details.kind,
      providerErrorStatus: details.status,
      providerErrorCode: details.code,
    },
    "provider request failed",
  );
  const providerPrefix = ctx.providerType ? `${ctx.providerType} ` : "";
  return new AppError(
    `${providerPrefix}provider request failed after ${attempts} attempt(s) (${details.kind})`,
    "PROVIDER_UNREACHABLE",
    {
      retryable,
      attempts,
      providerType: ctx.providerType ?? null,
      modelId: ctx.modelId ?? null,
      status: details.status,
      providerCode: details.code,
      errorKind: details.kind,
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
  kind:
    | "authentication"
    | "rate_limit"
    | "timeout"
    | "network"
    | "provider_4xx"
    | "provider_5xx"
    | "validation"
    | "unknown";
  status: number | null;
  code: string | null;
};

function safeProviderErrorDetails(error: unknown): ProviderErrorDetails {
  const status = readHttpStatusDeep(error);
  const rawCode = readErrorCodeDeep(error);
  const code =
    rawCode && /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode) ? rawCode : null;
  const rawName = error instanceof Error ? error.name : null;
  const name =
    rawName && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : null;
  const messages = collectMessageChain(error).join(" | ").toLowerCase();
  let kind: ProviderErrorDetails["kind"] = "unknown";
  if (status === 401 || status === 403) kind = "authentication";
  else if (status === 429) kind = "rate_limit";
  else if (status != null && status >= 500) kind = "provider_5xx";
  else if (status != null && status >= 400) kind = "provider_4xx";
  else if (messages.includes("validation") || messages.includes("schema"))
    kind = "validation";
  else if (messages.includes("timeout") || messages.includes("timed out"))
    kind = "timeout";
  else if (
    messages.includes("network") ||
    messages.includes("fetch failed") ||
    messages.includes("econn") ||
    messages.includes("enotfound") ||
    messages.includes("eai_again") ||
    messages.includes("socket")
  )
    kind = "network";
  return {
    name,
    kind,
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
