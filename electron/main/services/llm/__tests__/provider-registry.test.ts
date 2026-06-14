import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccount } from "@/lib/types";
import { ProviderRegistry } from "../provider-registry";

function buildAiAccount(overrides?: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: "provider-anthropic",
    name: "Anthropic",
    category: "ai",
    providerType: "anthropic",
    secretRef: "exva:anthropic",
    metadataJson: null,
    isConfigured: true,
    lastTestStatus: "unknown",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  const findMock = vi.fn();
  const secretsGetMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    findMock.mockReset();
    secretsGetMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200 },
      ),
    );
    secretsGetMock.mockResolvedValue("sk-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lazily initializes and caches adapters per provider account", async () => {
    const account = buildAiAccount();
    findMock.mockReturnValue(account);
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    const first = await registry.get(account.id);
    const second = await registry.get(account.id);

    expect(first).toBe(second);
    expect(first.providerType).toBe("anthropic");
    expect(secretsGetMock).toHaveBeenCalledTimes(1);
    expect(secretsGetMock).toHaveBeenCalledWith(account.secretRef);
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the adapter after invalidate", async () => {
    const account = buildAiAccount();
    findMock.mockReturnValue(account);
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    const first = await registry.get(account.id);
    registry.invalidate(account.id);
    const second = await registry.get(account.id);

    expect(first).not.toBe(second);
    expect(secretsGetMock).toHaveBeenCalledTimes(2);
  });

  it("routes openai, openrouter, and opencode provider types", async () => {
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    findMock.mockReturnValue(
      buildAiAccount({
        id: "provider-openai",
        providerType: "openai",
        secretRef: "exva:openai",
      }),
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), {
        status: 200,
      }),
    );
    expect((await registry.get("provider-openai")).providerType).toBe("openai");

    findMock.mockReturnValue(
      buildAiAccount({
        id: "provider-openrouter",
        providerType: "openrouter",
        secretRef: "exva:openrouter",
        metadataJson: JSON.stringify({
          baseUrl: "https://openrouter.example/api/v1",
        }),
      }),
    );
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "google/gemma-4-31b-it",
              name: "Gemma",
              context_length: 32000,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    registry.invalidate("provider-openai");
    expect((await registry.get("provider-openrouter")).providerType).toBe(
      "openrouter",
    );

    findMock.mockReturnValue(
      buildAiAccount({
        id: "provider-opencode",
        providerType: "openrouter",
        secretRef: "exva:opencode",
      }),
    );
    registry.invalidate("provider-openrouter");
    expect((await registry.get("provider-opencode")).providerType).toBe(
      "openrouter",
    );
  });

  it("delegates listModels to the cached adapter", async () => {
    const account = buildAiAccount();
    findMock.mockReturnValue(account);
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    const models = await registry.listModels(account.id);

    expect(models).toEqual([
      {
        id: "claude-sonnet-4",
        label: "Claude Sonnet 4",
        maxContextTokens: 200000,
      },
    ]);
    expect(secretsGetMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the provider account is missing or not configured", async () => {
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );
    findMock.mockReturnValue(null);

    await expect(registry.get("missing")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });

    findMock.mockReturnValue(buildAiAccount({ isConfigured: false }));
    await expect(registry.get("provider-anthropic")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });

    findMock.mockReturnValue(buildAiAccount({ category: "search" as never }));
    await expect(registry.get("provider-anthropic")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("throws when the provider secret is missing", async () => {
    findMock.mockReturnValue(buildAiAccount());
    secretsGetMock.mockResolvedValue(null);
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    await expect(registry.get("provider-anthropic")).rejects.toMatchObject({
      code: "MISSING_SECRET",
    });
  });

  it("throws for unsupported provider types", async () => {
    findMock.mockReturnValue(
      buildAiAccount({ providerType: "brave" as never }),
    );
    const registry = new ProviderRegistry(
      { find: findMock } as never,
      { get: secretsGetMock } as never,
    );

    await expect(registry.get("provider-anthropic")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });
});
