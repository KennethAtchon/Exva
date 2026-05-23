/** plan §8 — truncate, strip filler, keep encoding-safe text for fetch (encodeURIComponent applied by adapters). */
export function sanitizeSearchQuery(raw: string): string {
  let q = raw.trim();
  q = q
    .replace(
      /^\s*(i'?ll search for|let me (look up|search)|here'?s a search for)[^.:\n]*[.:]?\s*/i,
      "",
    )
    .trim();
  q = q.replace(/^['"`]+|['"`]+$/g, "").trim();
  q = q.replace(/\s+/g, " ").trim();
  return q.length > 200 ? q.slice(0, 200) : q;
}

const TOOL_NAME_QUERY_REGEX =
  /^(search_web|search_reddit|get_trending_symbols|get_quote|get_news|get_ohlcv|fetch_url|submit_result)$/i;

export interface DiscoveryQueryValidationResult {
  sanitized: string;
  normalizedFamily: string;
  ok: boolean;
  reason?: string;
}

export function validateDiscoveryQuery(
  raw: string,
): DiscoveryQueryValidationResult {
  const sanitized = sanitizeSearchQuery(raw);
  const normalizedFamily = normalizeQueryFamily(sanitized);

  if (!sanitized) {
    return {
      sanitized,
      normalizedFamily,
      ok: false,
      reason: "Query is empty after sanitization.",
    };
  }

  if (/^\d+$/.test(sanitized)) {
    return {
      sanitized,
      normalizedFamily,
      ok: false,
      reason: "Query must not be digits only.",
    };
  }

  if (TOOL_NAME_QUERY_REGEX.test(sanitized)) {
    return {
      sanitized,
      normalizedFamily,
      ok: false,
      reason:
        "Query must describe an instrument, catalyst, setup, or theme instead of a tool name.",
    };
  }

  if (sanitized.length < 3) {
    return {
      sanitized,
      normalizedFamily,
      ok: false,
      reason: "Query is too short to add meaningful discovery signal.",
    };
  }

  return { sanitized, normalizedFamily, ok: true };
}

export function normalizeQueryFamily(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
