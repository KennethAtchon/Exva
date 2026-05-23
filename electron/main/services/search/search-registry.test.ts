import { describe, expect, it } from "vitest";
import { buildBuiltInDuckDuckGoProviderAccount } from "@electron/shared/instruments/search-providers";
import { SearchRegistry } from "./search-registry";

describe("SearchRegistry", () => {
  it("builds the built-in DuckDuckGo adapter without a stored secret", async () => {
    const account = buildBuiltInDuckDuckGoProviderAccount();
    const registry = new SearchRegistry(
      {
        find: (id: string) => (id === account.id ? account : null),
      } as never,
      {
        get: async () => null,
      } as never,
    );

    const adapter = await registry.get(account.id);
    expect(adapter.providerType).toBe("duckduckgo");
  });
});
