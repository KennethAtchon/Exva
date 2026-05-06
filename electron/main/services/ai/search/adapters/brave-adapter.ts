import { AppError } from "@electron/shared/errors";
import type { SearchAdapter, SearchResult } from "../search-types";

function toSearchSummary(items: unknown[]): string {
  const lines: string[] = [];
  for (const [index, item] of items.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : "";
    const description =
      typeof (item as { description?: unknown }).description === "string"
        ? (item as { description: string }).description
        : "";
    const url = typeof (item as { url?: unknown }).url === "string" ? (item as { url: string }).url : "";
    const snippet = [title, description, url].filter(Boolean).join(" — ");
    if (!snippet) continue;
    lines.push(`${index + 1}. ${snippet}`);
  }
  return lines.join("\n");
}

export class BraveAdapter implements SearchAdapter {
  readonly providerType = "brave" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<SearchResult> {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });
    if (!response.ok) {
      throw new AppError(`Brave search failed with ${response.status}`, "PROVIDER_UNREACHABLE");
    }
    const body = (await response.json()) as { web?: { results?: unknown[] } };
    const results = toSearchSummary(body.web?.results ?? []);
    return { results };
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
