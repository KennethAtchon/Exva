import { AppError } from "@electron/shared/infra/errors";
import { isBuiltInSearchProviderAccount } from "@electron/shared/catalog/search-providers";
import type { ProviderAccount } from "@/lib/types";
import type { ProviderAccountsRepo } from "../../../db/repositories/workspace/provider-accounts-repo";
import type { SecretsService } from "../../infra/secrets-service";
import { BraveAdapter } from "./adapters/brave-adapter";
import { DuckDuckGoAdapter } from "./adapters/duckduckgo-adapter";
import { McpSearchAdapter } from "./adapters/mcp-adapter";
import { TavilyAdapter } from "./adapters/tavily-adapter";
import { parseProviderMetadata } from "@electron/shared/catalog/search-providers";
import type { SearchAdapter } from "./search-types";

export class SearchRegistry {
  private readonly adapters = new Map<string, SearchAdapter>();

  constructor(
    private readonly providerAccountsRepo: ProviderAccountsRepo,
    private readonly secrets: SecretsService,
  ) {}

  async get(providerKey: string): Promise<SearchAdapter> {
    const existing = this.adapters.get(providerKey);
    if (existing) return existing;

    const account = this.providerAccountsRepo.find(providerKey);
    if (!account || !account.isConfigured || account.category !== "search") {
      throw new AppError(
        `Search provider not configured: ${providerKey}`,
        "SEARCH_PROVIDER_REQUIRED",
        { providerKey },
      );
    }

    const secret = isBuiltInSearchProviderAccount(account)
      ? null
      : await this.secrets.get(account.secretRef);
    if (!isBuiltInSearchProviderAccount(account) && !secret) {
      throw new AppError(
        `No secret for search provider: ${providerKey}`,
        "MISSING_SECRET",
        { providerKey },
      );
    }

    const adapter = this.buildAdapter(account, secret);
    this.adapters.set(providerKey, adapter);
    return adapter;
  }

  invalidate(providerKey: string): void {
    this.adapters.delete(providerKey);
  }

  private buildAdapter(
    account: ProviderAccount,
    secret: string | null,
  ): SearchAdapter {
    switch (account.providerType) {
      case "duckduckgo":
        return new DuckDuckGoAdapter();
      case "brave":
        return new BraveAdapter(secret ?? "");
      case "tavily":
        return new TavilyAdapter(secret ?? "");
      case "mcp": {
        const metadata = parseProviderMetadata(account.metadataJson);
        if (!metadata.baseUrl?.trim()) {
          throw new AppError(
            "MCP search provider requires metadata.baseUrl",
            "VALIDATION_FAILED",
            {
              providerKey: account.id,
            },
          );
        }
        return new McpSearchAdapter(account, secret ?? "");
      }
      default:
        throw new AppError(
          `Unsupported search provider type: ${account.providerType}`,
          "SEARCH_PROVIDER_REQUIRED",
        );
    }
  }
}
