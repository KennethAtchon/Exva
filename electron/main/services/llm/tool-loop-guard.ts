import type { StepResult, ToolSet } from "ai";
import { normalizeQueryFamily } from "../search/sanitize-search-query";

export function buildToolStepSignature(
  step: Pick<StepResult<ToolSet>, "toolCalls">,
): string {
  return step.toolCalls
    .map(
      (call) =>
        `${String(call.toolName)}:${canonicalizeToolInput(String(call.toolName), call.input)}`,
    )
    .join("|");
}

export function canonicalizeToolInput(
  toolName: string,
  input: unknown,
): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return JSON.stringify(input ?? null);
  }

  if (toolName === "search_web" || toolName === "search_reddit") {
    const query = readStringField(input, "query") ?? "";
    return normalizeQueryFamily(query);
  }

  if (toolName === "fetch_url") {
    const url = readStringField(input, "url") ?? "";
    return extractDomain(url) ?? url;
  }

  if (toolName === "get_ohlcv") {
    const symbol = normalizeSymbol(readStringField(input, "symbol"));
    const timeframe = readStringField(input, "timeframe") ?? "";
    const instrumentClass = readStringField(input, "instrumentClass") ?? "";
    return `${symbol ?? "?"}:${instrumentClass}:${timeframe}`;
  }

  if (toolName === "get_quote" || toolName === "get_news") {
    return (
      normalizeSymbol(readStringField(input, "symbol")) ?? JSON.stringify(input)
    );
  }

  return JSON.stringify(input);
}

function extractDomain(urlValue: string | undefined): string | null {
  if (!urlValue) return null;
  try {
    return new URL(urlValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeSymbol(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("pm:") ? trimmed : trimmed.toUpperCase();
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}
