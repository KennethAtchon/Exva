import { AppError } from "@electron/shared/infra/errors";
import type { SearchAdapter, SearchToolResult } from "../search-types";

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    hellip: "...",
  };

  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (_, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      }
      return named[entity] ?? _;
    },
  );
}

function normalizeText(value: string): string {
  return decodeHtml(stripTags(value));
}

function clampSnippet(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function unwrapDuckDuckGoUrl(rawHref: string): string {
  const decodedHref = decodeHtml(rawHref).trim();
  const candidate = decodedHref.startsWith("//")
    ? `https:${decodedHref}`
    : decodedHref;

  try {
    const url = new URL(candidate, "https://duckduckgo.com");
    const redirectTarget = url.searchParams.get("uddg");
    if (redirectTarget) {
      return decodeURIComponent(redirectTarget);
    }
    return url.toString();
  } catch {
    return candidate;
  }
}

type ParsedResult = SearchToolResult["results"][number];

function parseResults(html: string): ParsedResult[] {
  const blocks =
    html.match(
      /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>?/g,
    ) ?? [];
  const results: ParsedResult[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;
    const [, href, rawTitle] = titleMatch;
    const snippetMatch =
      block.match(
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      ) ??
      block.match(
        /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );

    const title = normalizeText(rawTitle);
    const url = unwrapDuckDuckGoUrl(href);
    const snippetSource = snippetMatch?.[1] ?? (title || url);
    const snippet = clampSnippet(normalizeText(snippetSource));

    if (!url) continue;
    results.push({
      url,
      title: title || url,
      snippet,
      publishedDate: null,
    });
  }

  return results.slice(0, 5);
}

const MAX_FETCH_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient failure — worth a short backoff-and-retry before giving up. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * DuckDuckGo's unauthenticated HTML endpoint has no SLA and rate-limits
 * aggressively under concurrent worker load — the 2026-07-19 overnight
  * stress run saw a ~49% error rate here (docs/attic/reviews/2026-07-19-overnight-
 * stress-session-review.md, secondary problem 9). A short retry with
 * backoff absorbs most transient 429/5xx blips before the caller falls back
 * to a different search provider.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = MAX_FETCH_ATTEMPTS,
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !isRetryableStatus(response.status)) {
        return response;
      }
      lastResponse = response;
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      await sleep(250 * attempt);
    }
  }
  // Prefer surfacing the last non-ok response (so callers' status-code
  // handling still fires) over a raw network error from an earlier attempt.
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class DuckDuckGoAdapter implements SearchAdapter {
  readonly providerType = "duckduckgo" as const;

  async search(query: string): Promise<SearchToolResult> {
    const response = await fetchWithRetry(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Exva/1.0 (+https://local.app)",
        },
      },
    );
    if (!response.ok) {
      throw new AppError(
        `DuckDuckGo search failed with ${response.status}`,
        "PROVIDER_UNREACHABLE",
      );
    }

    const html = await response.text();
    const results = parseResults(html);
    if (results.length === 0) {
      throw new AppError(
        "DuckDuckGo search returned no parseable results.",
        "PROVIDER_UNREACHABLE",
      );
    }

    return {
      results,
      query,
      provider: "duckduckgo",
      creditsUsed: 0,
      cachedAt: null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.search("market news");
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
