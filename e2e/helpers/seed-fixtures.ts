import type { Page } from "@playwright/test";

export type SeededPaperSession = {
  brokerAccountId: string;
  sessionId: string;
  sessionName: string;
};

/** Seed mock broker, AI provider, and a paper session via the preload bridge. */
export async function seedPaperTradingSession(
  window: Page,
  options?: { sessionName?: string },
): Promise<SeededPaperSession> {
  const sessionName = options?.sessionName ?? "E2E Paper Session";

  return window.evaluate(async (name) => {
    const exva = window.exva;
    if (!exva) throw new Error("window.exva is not available");

    const brokerResult = await exva.accounts.addBroker({
      brokerType: "mock",
      name: "E2E Mock Broker",
      mode: "paper",
      credentials: {},
    });
    if (!brokerResult.ok) {
      throw new Error(`Failed to add broker: ${brokerResult.message}`);
    }
    const brokerAccountId = brokerResult.id;

    const providerResult = await exva.accounts.saveProvider({
      name: "E2E OpenRouter",
      category: "ai",
      providerType: "openrouter",
      apiKey: "e2e-test-key",
    });

    await exva.strategy.saveWorkspaceDefaultModel({
      providerKey: providerResult.id,
      modelId: "google/gemma-4-31b-it",
    });

    const created = await exva.session.create({
      name,
      objective: "E2E paper trading on NVDA",
      selectionMode: "manual_shortlist",
      instrumentScope: "NVDA",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      brokerAssignments: [{ brokerAccountId, allocatedUsd: 5000 }],
      brokerOverridesByInstrumentClass: { stock: brokerAccountId },
    });

    await exva.session.focus(created.id);

    return {
      brokerAccountId,
      sessionId: created.id,
      sessionName: name,
    };
  }, sessionName);
}

export async function getFocusedSessionStatus(window: Page): Promise<string> {
  return window.evaluate(async () => {
    const exva = window.exva;
    if (!exva) throw new Error("window.exva is not available");
    return exva.session.getStatus();
  });
}
