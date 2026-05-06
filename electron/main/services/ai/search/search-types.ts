import type { SearchProviderType } from "@/lib/types";

/** Structured search payload returned to the model (plan §8). */
export interface SearchToolResult {
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    publishedDate: string | null;
  }>;
  query: string;
  provider: SearchProviderType;
  creditsUsed: number;
  cachedAt: string | null;
}

export interface SearchAdapter {
  readonly providerType: SearchProviderType;
  search(query: string): Promise<SearchToolResult>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
