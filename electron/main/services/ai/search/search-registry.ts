import { AppError } from "@electron/shared/errors";
import type { ProviderAccount } from "@/lib/types";
import type { ProviderAccountsRepo } from "../../../db/repositories/provider-accounts-repo";
import type { SecretsService } from "../../infra/secrets-service";
import { BraveAdapter } from "./adapters/brave-adapter";
import { TavilyAdapter } from "./adapters/tavily-adapter";
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
      throw new AppError(`Search provider not configured: ${providerKey}`, "SEARCH_PROVIDER_REQUIRED", { providerKey });
    }

    const secret = await this.secrets.get(account.secretRef);
    if (!secret) {
      throw new AppError(`No secret for search provider: ${providerKey}`, "MISSING_SECRET", { providerKey });
    }

    const adapter = this.buildAdapter(account, secret);
    this.adapters.set(providerKey, adapter);
    return adapter;
  }

  invalidate(providerKey: string): void {
    this.adapters.delete(providerKey);
  }

  private buildAdapter(account: ProviderAccount, secret: string): SearchAdapter {
    switch (account.providerType) {
      case "brave":
        return new BraveAdapter(secret);
      case "tavily":
        return new TavilyAdapter(secret);
      default:
        throw new AppError(`Unsupported search provider type: ${account.providerType}`, "SEARCH_PROVIDER_REQUIRED");
    }
  }
}
