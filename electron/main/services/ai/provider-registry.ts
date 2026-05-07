import { AppError } from "@electron/shared/errors";
import type { ProviderAccount } from "@/lib/types";
import type { ProviderAccountsRepo } from "../../db/repositories/provider-accounts-repo";
import type { SecretsService } from "../infra/secrets-service";
import { AnthropicAdapter } from "./adapters/anthropic-adapter";
import { OpenAiAdapter } from "./adapters/openai-adapter";
import { OpenRouterAdapter } from "./adapters/openrouter-adapter";
import type { ModelEntry, ProviderAdapter } from "./adapters/provider-adapter";

type OpenRouterMetadata = {
  baseUrl?: string;
};

function parseMetadata(value: string | null): OpenRouterMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const baseUrl = typeof (parsed as { baseUrl?: unknown }).baseUrl === "string"
      ? (parsed as { baseUrl: string }).baseUrl
      : undefined;
    return { baseUrl };
  } catch {
    return {};
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(
    private readonly providerAccountsRepo: ProviderAccountsRepo,
    private readonly secrets: SecretsService,
  ) {}

  async get(providerKey: string): Promise<ProviderAdapter> {
    const existing = this.adapters.get(providerKey);
    if (existing) return existing;

    const account = this.providerAccountsRepo.find(providerKey);
    if (!account || !account.isConfigured || account.category !== "ai") {
      throw new AppError(`Provider not configured: ${providerKey}`, "PROVIDER_NOT_CONFIGURED", { providerKey });
    }

    const secret = await this.secrets.get(account.secretRef);
    if (!secret) {
      throw new AppError(`No secret for provider: ${providerKey}`, "MISSING_SECRET", { providerKey });
    }

    const adapter = this.buildAdapter(account, secret);
    this.adapters.set(providerKey, adapter);
    return adapter;
  }

  async listModels(providerKey: string): Promise<ModelEntry[]> {
    const adapter = await this.get(providerKey);
    return adapter.listModels();
  }

  invalidate(providerKey: string): void {
    this.adapters.delete(providerKey);
  }

  private buildAdapter(account: ProviderAccount, secret: string): ProviderAdapter {
    const providerType = String(account.providerType);
    switch (providerType) {
      case "anthropic":
        return new AnthropicAdapter(secret);
      case "openai":
        return new OpenAiAdapter(secret);
      case "openrouter":
      case "opencode": {
        const metadata = parseMetadata(account.metadataJson);
        return new OpenRouterAdapter(secret, metadata.baseUrl);
      }
      default:
        throw new AppError(`Unsupported provider type: ${account.providerType}`, "PROVIDER_NOT_CONFIGURED");
    }
  }
}
