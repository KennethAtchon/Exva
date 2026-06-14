import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "../anthropic-adapter";
import { OpenAiAdapter } from "../openai-adapter";
import { OpenRouterAdapter } from "../openrouter-adapter";
import type { ProviderAdapter } from "../provider-adapter";

const requiredMethods: Array<keyof ProviderAdapter> = [
  "generateText",
  "generateObject",
  "runAgent",
  "testConnection",
  "listModels",
];

function expectProviderAdapterShape(
  adapter: ProviderAdapter,
  providerType: ProviderAdapter["providerType"],
) {
  expect(adapter.providerType).toBe(providerType);
  for (const method of requiredMethods) {
    expect(typeof adapter[method]).toBe("function");
  }
}

describe("ProviderAdapter interface compliance", () => {
  it("anthropic adapter exposes the shared provider contract", () => {
    expectProviderAdapterShape(new AnthropicAdapter("sk-test"), "anthropic");
  });

  it("openai adapter exposes the shared provider contract", () => {
    expectProviderAdapterShape(new OpenAiAdapter("sk-test"), "openai");
  });

  it("openrouter adapter exposes the shared provider contract", () => {
    expectProviderAdapterShape(
      new OpenRouterAdapter("sk-or-test"),
      "openrouter",
    );
  });
});
