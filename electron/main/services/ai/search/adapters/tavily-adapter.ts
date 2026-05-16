import { AppError } from "@electron/shared/infra/errors";
import type { SearchAdapter, SearchToolResult } from "../search-types";

function clampSnippet(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function postWithRetry(body: Record<string, unknown>): Promise<Response> {
  const delays = [0, 1000, 2000, 4000];
  let last: Response | null = null;
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i] ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * (delay || 1))));
    last = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (last.status !== 429) return last;
  }
  return last ?? new Response("", { status: 599 });
}

export class TavilyAdapter implements SearchAdapter {
  readonly providerType = "tavily" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<SearchToolResult> {
    const response = await postWithRetry({
      api_key: this.apiKey,
      query,
      search_depth: "advanced",
      max_results: 7,
      include_answer: false,
      include_raw_content: false,
    });
    if (!response.ok) {
      throw new AppError(`Tavily search failed with ${response.status}`, "PROVIDER_UNREACHABLE");
    }
    const body = (await response.json()) as { results?: unknown[] };
    const raw = body.results ?? [];
    const results: SearchToolResult["results"] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : "";
      const content =
        typeof (item as { content?: unknown }).content === "string" ? (item as { content: string }).content : "";
      const url = typeof (item as { url?: unknown }).url === "string" ? (item as { url: string }).url : "";
      results.push({
        url: url || "",
        title: title || url || "result",
        snippet: content ? clampSnippet(content, 6000) : clampSnippet(title || url, 200),
        publishedDate: null,
      });
    }
    return {
      results,
      query,
      provider: "tavily",
      creditsUsed: 1,
      cachedAt: null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.search("market news");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
