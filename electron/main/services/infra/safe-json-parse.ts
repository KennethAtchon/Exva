import type { z } from "zod";
import { createLogger } from "./log";

const log = createLogger("safe-json-parse");

/**
 * Parse JSON without throwing. Returns null on syntax errors or schema failure.
 * Pass `context` to log a warn on failure (best-effort / cache reads).
 */
export function safeJsonParse<T = unknown>(
  raw: string,
  schema?: z.ZodType<T>,
  context?: string,
): T | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!schema) return value as T;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    warnParseFailure(context, { issues: parsed.error.issues }, "schema");
    return null;
  } catch (err) {
    warnParseFailure(context, { err }, "syntax");
    return null;
  }
}

function warnParseFailure(
  context: string | undefined,
  fields: Record<string, unknown>,
  kind: "schema" | "syntax",
): void {
  if (!context) return;
  try {
    log.warn(
      { context, ...fields },
      kind === "schema" ? "JSON schema validation failed" : "JSON.parse failed",
    );
  } catch {
    // Logging must never break parse fallback (e.g. closed log streams in tests).
  }
}

/** Parse JSON or throw — use on money/config paths where null would hide corruption. */
export function requireJsonParse<T = unknown>(
  raw: string,
  schema?: z.ZodType<T>,
  message = "Invalid JSON",
): T {
  const parsed = safeJsonParse(raw, schema);
  if (parsed == null) throw new Error(message);
  return parsed;
}
