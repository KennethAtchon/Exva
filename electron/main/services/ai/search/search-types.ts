import type { SearchProviderType } from "@/lib/types";

export interface SearchResult {
  results: string;
}

export interface SearchAdapter {
  readonly providerType: SearchProviderType;
  search(query: string): Promise<SearchResult>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
