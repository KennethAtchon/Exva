import { AppError } from "@electron/shared/infra/errors";
import type { SearchAdapter, SearchToolResult } from "../search-types";

function clampSnippet(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const delays = [0, 1000, 2000, 4000];
  let last: Response | null = null;
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i] ?? 0;
    if (delay > 0)
      await new Promise((r) =>
        setTimeout(r, delay + Math.floor(Math.random() * (delay || 1))),
      );
    last = await fetch(url, init);
    if (last.status !== 429) return last;
  }
  return last ?? new Response("", { status: 599 });
}

export class BraveAdapter implements SearchAdapter {
  readonly providerType = "brave" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<SearchToolResult> {
    const response = await fetchWithRetry(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
      },
    );
    if (!response.ok) {
      throw new AppError(
        `Brave search failed with ${response.status}`,
        "PROVIDER_UNREACHABLE",
      );
    }
    const body = (await response.json()) as { web?: { results?: unknown[] } };
    const raw = body.web?.results ?? [];
    const results: SearchToolResult["results"] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const title =
        typeof (item as { title?: unknown }).title === "string"
          ? (item as { title: string }).title
          : "";
      const description =
        typeof (item as { description?: unknown }).description === "string"
          ? (item as { description: string }).description
          : "";
      const url =
        typeof (item as { url?: unknown }).url === "string"
          ? (item as { url: string }).url
          : "";
      const published =
        typeof (item as { age?: unknown }).age === "string"
          ? (item as { age: string }).age
          : typeof (item as { page_age?: unknown }).page_age === "string"
            ? (item as { page_age: string }).page_age
            : null;
      const snippet = clampSnippet(
        [title, description].filter(Boolean).join(" — ") || url,
      );
      if (!snippet && !url) continue;
      results.push({
        url: url || "",
        title: title || url || "result",
        snippet,
        publishedDate: published,
      });
    }
    return {
      results,
      query,
      provider: "brave",
      creditsUsed: 1,
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
