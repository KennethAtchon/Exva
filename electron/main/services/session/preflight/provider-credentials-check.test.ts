import { describe, expect, it } from "vitest";
import { providerCredentialsCheck } from "./provider-credentials-check";

describe("providerCredentialsCheck", () => {
  const session = { id: "session-1" } as const;

  it("accepts configured AI providers for every phase", async () => {
    const result = await providerCredentialsCheck(
      session as never,
      {
        strategyContextService: {
          getSelectorSettings: () => ({
            aiPickerEnabled: true,
            noInstrumentRetryMinutes: null,
          }),
          listAiPhases: () => [
            {
              phase: "selector",
              providerKey: "provider-openrouter",
              modelId: "google/gemma-4-31b-it",
            },
          ],
        },
        providerAccountsRepo: {
          find: (id: string) =>
            id === "provider-openrouter"
              ? {
                  id,
                  name: "OpenRouter",
                  category: "ai",
                  isConfigured: true,
                }
              : null,
        },
      } as never,
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects missing, non-AI, or unconfigured providers", async () => {
    const strategyContextService = {
      listAiPhases: () => [
        {
          phase: "decision",
          providerKey: "provider-openrouter",
          modelId: "google/gemma-4-31b-it",
        },
      ],
    };
    const providerAccountsRepo = {
      find: () => null,
    };

    expect(
      await providerCredentialsCheck(
        session as never,
        {
          strategyContextService,
          providerAccountsRepo,
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      message: expect.stringContaining('phase "decision"'),
    });

    expect(
      await providerCredentialsCheck(
        session as never,
        {
          strategyContextService: {
            getSelectorSettings: () => ({
              aiPickerEnabled: true,
              noInstrumentRetryMinutes: null,
            }),
            listAiPhases: () => [
              { phase: "selector", providerKey: "", modelId: "model" },
            ],
          },
          providerAccountsRepo,
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('phase "selector" has no provider'),
    });

    expect(
      await providerCredentialsCheck(
        session as never,
        {
          strategyContextService: {
            getSelectorSettings: () => ({
              aiPickerEnabled: true,
              noInstrumentRetryMinutes: null,
            }),
            listAiPhases: () => [
              {
                phase: "selector",
                providerKey: "search-1",
                modelId: "model",
              },
            ],
          },
          providerAccountsRepo: {
            find: () => ({
              id: "search-1",
              name: "Brave",
              category: "search",
              isConfigured: true,
            }),
          },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("not an AI provider"),
    });

    expect(
      await providerCredentialsCheck(
        session as never,
        {
          strategyContextService: {
            getSelectorSettings: () => ({
              aiPickerEnabled: true,
              noInstrumentRetryMinutes: null,
            }),
            listAiPhases: () => [
              {
                phase: "selector",
                providerKey: "provider-openrouter",
                modelId: "",
              },
            ],
          },
          providerAccountsRepo: {
            find: () => ({
              id: "provider-openrouter",
              name: "OpenRouter",
              category: "ai",
              isConfigured: true,
            }),
          },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("Select a model"),
    });
  });
});
