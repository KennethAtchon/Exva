import type { ProviderAccount } from "../domain";

export interface ProviderMetadata {
  baseUrl?: string;
  /** MCP tools/call target when providerType is `mcp` (default: search). */
  mcpToolName?: string;
  /** How the MCP endpoint expects the stored API key to be sent. */
  mcpAuthMode?: "bearer" | "query";
  /** Query parameter name for `mcpAuthMode: "query"`. */
  mcpApiKeyQueryParam?: string;
}

export const BUILT_IN_DUCKDUCKGO_PROVIDER_ID = "builtin-search-duckduckgo";
const BUILT_IN_DUCKDUCKGO_SECRET_REF = "builtin-search-duckduckgo";

export function isBuiltInSearchProviderAccount(
  account: Pick<ProviderAccount, "id" | "providerType" | "category">,
): boolean {
  return (
    account.category === "search" &&
    (account.id === BUILT_IN_DUCKDUCKGO_PROVIDER_ID ||
      account.providerType === "duckduckgo")
  );
}

export function buildBuiltInDuckDuckGoProviderAccount(
  now = new Date().toISOString(),
): ProviderAccount {
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
    const rawToolName = (value as { mcpToolName?: unknown }).mcpToolName;
    const rawAuthMode = (value as { mcpAuthMode?: unknown }).mcpAuthMode;
    const rawQueryParam = (value as { mcpApiKeyQueryParam?: unknown })
      .mcpApiKeyQueryParam;
    return {
      baseUrl:
        typeof rawBaseUrl === "string" && rawBaseUrl.trim().length > 0
          ? rawBaseUrl.trim()
          : undefined,
      mcpToolName:
        typeof rawToolName === "string" && rawToolName.trim().length > 0
          ? rawToolName.trim()
          : undefined,
      mcpAuthMode:
        rawAuthMode === "query" || rawAuthMode === "bearer"
          ? rawAuthMode
          : undefined,
      mcpApiKeyQueryParam:
        typeof rawQueryParam === "string" && rawQueryParam.trim().length > 0
          ? rawQueryParam.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

export function getSearchProviderDisplayName(
  value: string | null | undefined,
): string {
  if (!value) return "Workspace default";
  if (value === BUILT_IN_DUCKDUCKGO_PROVIDER_ID) return "DuckDuckGo (Built-in)";
  return value;
}
