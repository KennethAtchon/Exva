import { AppError } from "@electron/shared/errors";

type RetryConfig = {
  timeoutMs: number;
  backoffMs: number;
};

const RETRY_CONFIG: RetryConfig = {
  timeoutMs: 60_000,
  backoffMs: 1_000,
};

export async function withProviderRetry<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(action);
  } catch (error) {
    if (!shouldRetry(error)) throw wrapProviderError(error);
  }

  await new Promise((resolve) => setTimeout(resolve, RETRY_CONFIG.backoffMs));

  try {
    return await withTimeout(action);
  } catch (error) {
    throw wrapProviderError(error);
  }
}

async function withTimeout<T>(action: () => Promise<T>): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error("AI request timed out"));
    }, RETRY_CONFIG.timeoutMs);
  });
  return Promise.race([action(), timeoutPromise]);
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
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("validation") || lower.includes("schema")) return false;
  if (/\b4\d\d\b/.test(raw) && !/\b429\b/.test(raw)) return false;
  if (/\b429\b/.test(raw)) return true;
  if (/\b5\d{2}\b/.test(raw)) return true;
  if (
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("network") ||
    lower.includes("fetch failed")
  ) {
    return true;
  }
  return false;
}

function wrapProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(`Provider unreachable: ${message}`, "PROVIDER_UNREACHABLE");
}
