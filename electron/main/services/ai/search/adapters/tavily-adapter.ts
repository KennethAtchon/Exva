import type { SearchAdapter, SearchResult } from "../search-types";

function normalize(results: unknown[]): string {
  const lines: string[] = [];
  for (const [index, item] of results.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : "";
    const content =
      typeof (item as { content?: unknown }).content === "string" ? (item as { content: string }).content : "";
    const url = typeof (item as { url?: unknown }).url === "string" ? (item as { url: string }).url : "";
    const snippet = [title, content, url].filter(Boolean).join(" — ");
    if (!snippet) continue;
    lines.push(`${index + 1}. ${snippet}`);
  }
  return lines.join("\n");
}

export class TavilyAdapter implements SearchAdapter {
  readonly providerType = "tavily" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<SearchResult> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: 5,
      }),
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed with ${response.status}`);
    }
    const body = (await response.json()) as { results?: unknown[] };
    return { results: normalize(body.results ?? []) };
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
