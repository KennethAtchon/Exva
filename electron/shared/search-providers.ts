import type { ProviderAccount } from "./domain";

export interface ProviderMetadata {
  baseUrl?: string;
}

export const BUILT_IN_DUCKDUCKGO_PROVIDER_ID = "builtin-search-duckduckgo";
export const BUILT_IN_DUCKDUCKGO_SECRET_REF = "builtin-search-duckduckgo";

export function isBuiltInSearchProviderId(id: string | null | undefined): boolean {
  return id === BUILT_IN_DUCKDUCKGO_PROVIDER_ID;
}

export function isBuiltInSearchProviderAccount(account: Pick<ProviderAccount, "id" | "providerType" | "category">): boolean {
  return account.category === "search" && (account.id === BUILT_IN_DUCKDUCKGO_PROVIDER_ID || account.providerType === "duckduckgo");
}

export function buildBuiltInDuckDuckGoProviderAccount(now = new Date().toISOString()): ProviderAccount {
  return {
    id: BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
    name: "DuckDuckGo (Built-in)",
    category: "search",
    providerType: "duckduckgo",
    secretRef: BUILT_IN_DUCKDUCKGO_SECRET_REF,
    metadataJson: null,
    isConfigured: true,
    lastTestStatus: "unknown",
    updatedAt: now,
  };
}

export function parseProviderMetadata(json: string | null): ProviderMetadata {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    if (typeof value !== "object" || value === null) return {};
    const rawBaseUrl = (value as { baseUrl?: unknown }).baseUrl;
    return {
      baseUrl: typeof rawBaseUrl === "string" && rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export function getSearchProviderDisplayName(value: string | null | undefined): string {
  if (!value) return "Workspace default";
  if (value === BUILT_IN_DUCKDUCKGO_PROVIDER_ID) return "DuckDuckGo (Built-in)";
  return value;
}
