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

export class DuckDuckGoAdapter implements SearchAdapter {
  readonly providerType = "duckduckgo" as const;

  async search(query: string): Promise<SearchToolResult> {
    const response = await fetch(
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
