import { describe, expect, it } from "vitest";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/catalog/search-providers";
import { selectorConfigCheck } from "./selector-config-check";

describe("selectorConfigCheck", () => {
  const baseSession = {
    id: "s1",
    selectionMode: "ai_selected_universe",
    defaultSearchProviderId: null,
  };

  it("requires a search provider for ai-selected universe", async () => {
    const result = await selectorConfigCheck(baseSession as never, {
      sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: true }) },
      workspacePreferencesRepo: { get: () => ({ defaultSearchProviderId: null }) },
      providerAccountsRepo: { find: () => null },
      sessionAiPhasesRepo: { getByPhase: () => ({ providerKey: "ai-1", modelId: "model-1" }) },
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SEARCH_PROVIDER_REQUIRED");
    expect(result.message).toContain("DuckDuckGo");
    expect(result.message).toContain("OpenRouter");
  });

  it("accepts configured search provider and selector phase", async () => {
    const result = await selectorConfigCheck({ ...baseSession, defaultSearchProviderId: "search-1" } as never, {
      sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: true }) },
      workspacePreferencesRepo: { get: () => ({ defaultSearchProviderId: null }) },
      providerAccountsRepo: {
        find: (id: string) =>
          id === "search-1"
            ? { id, category: "search", isConfigured: true }
            : id === "ai-1"
              ? { id, category: "ai", isConfigured: true }
            : null,
      },
      sessionAiPhasesRepo: { getByPhase: () => ({ providerKey: "ai-1", modelId: "model-1" }) },
    } as never);

    expect(result).toEqual({ ok: true });
  });

  it("accepts the built-in workspace default search provider", async () => {
    const result = await selectorConfigCheck(baseSession as never, {
      sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: true }) },
      workspacePreferencesRepo: { get: () => ({ defaultSearchProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID }) },
      providerAccountsRepo: {
        find: (id: string) =>
          id === BUILT_IN_DUCKDUCKGO_PROVIDER_ID
            ? { id, category: "search", isConfigured: true }
            : id === "ai-1"
              ? { id, category: "ai", isConfigured: true }
              : null,
      },
      sessionAiPhasesRepo: { getByPhase: () => ({ providerKey: "ai-1", modelId: "model-1" }) },
    } as never);

    expect(result).toEqual({ ok: true });
  });
});
