import type { Page } from "@playwright/test";

export type SeededPaperSession = {
  brokerAccountId: string;
  sessionId: string;
  sessionName: string;
};

export type MultiSessionSeedOptions = {
  brokerName?: string;
  brokerMaxSessions?: number;
  sessions: Array<{
    name: string;
    allocatedUsd: number;
    instrumentScope?: string;
    experienceId?: string;
  }>;
};

export type SeededMultiSessionWorkspace = {
  brokerAccountId: string;
  providerAccountId: string;
  sessions: SeededPaperSession[];
};

/** Seed mock broker, AI provider, and a paper session via the preload bridge. */
export async function seedPaperTradingSession(
  window: Page,
  options?: {
    sessionName?: string;
    instrumentScope?: string;
    experienceId?: string;
    allocatedUsd?: number;
  },
): Promise<SeededPaperSession> {
  const sessionName = options?.sessionName ?? "E2E Paper Session";
  const instrumentScope = options?.instrumentScope ?? "NVDA";
  const experienceId = options?.experienceId ?? "edgar-catalyst";
  const allocatedUsd = options?.allocatedUsd ?? 5000;

  return window.evaluate(async (seedOptions) => {
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
      name: seedOptions.sessionName,
      objective: `E2E paper trading on ${seedOptions.instrumentScope}`,
      selectionMode: "manual_shortlist",
      instrumentScope: seedOptions.instrumentScope,
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      experienceId: seedOptions.experienceId,
      brokerAssignments: [
        { brokerAccountId, allocatedUsd: seedOptions.allocatedUsd },
      ],
      brokerOverridesByInstrumentClass: { stock: brokerAccountId },
    });

    await exva.session.focus(created.id);

    return {
      brokerAccountId,
      sessionId: created.id,
      sessionName: seedOptions.sessionName,
    };
  }, { sessionName, instrumentScope, experienceId, allocatedUsd });
}

export async function seedMeanReversionSession(
  window: Page,
  options?: { sessionName?: string; instrumentScope?: string },
): Promise<SeededPaperSession> {
  return seedPaperTradingSession(window, {
    sessionName: options?.sessionName ?? "E2E Mean Reversion Session",
    instrumentScope: options?.instrumentScope ?? "NVDA",
    experienceId: "mean-reversion",
  });
}

export async function seedMultiSessionWorkspace(
  window: Page,
  options: MultiSessionSeedOptions,
): Promise<SeededMultiSessionWorkspace> {
  return window.evaluate(async (seedOptions) => {
    const exva = window.exva;
    if (!exva) throw new Error("window.exva is not available");

    const brokerResult = await exva.accounts.addBroker({
      brokerType: "mock",
      name: seedOptions.brokerName ?? "E2E Shared Mock Broker",
      mode: "paper",
      credentials: {},
    });
    if (!brokerResult.ok) {
      throw new Error(`Failed to add broker: ${brokerResult.message}`);
    }
    const brokerAccountId = brokerResult.id;

    if (seedOptions.brokerMaxSessions != null) {
      await exva.brokerAccounts.updateSettings({
        brokerAccountId,
        maxSessions: seedOptions.brokerMaxSessions,
      });
    }

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

    const sessions = [];
    for (const session of seedOptions.sessions) {
      const created = await exva.session.create({
        name: session.name,
        objective: `E2E paper trading on ${session.instrumentScope ?? "NVDA"}`,
        selectionMode: "manual_shortlist",
        instrumentScope: session.instrumentScope ?? "NVDA",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        experienceId: session.experienceId ?? "edgar-catalyst",
        brokerAssignments: [
          { brokerAccountId, allocatedUsd: session.allocatedUsd },
        ],
        brokerOverridesByInstrumentClass: { stock: brokerAccountId },
      });
      sessions.push({
        brokerAccountId,
        sessionId: created.id,
        sessionName: session.name,
      });
    }

    if (sessions[0]) {
      await exva.session.focus(sessions[0].sessionId);
    }

    return {
      brokerAccountId,
      providerAccountId: providerResult.id,
      sessions,
    };
  }, options);
}

export async function getFocusedSessionStatus(window: Page): Promise<string> {
  return window.evaluate(async () => {
    const exva = window.exva;
    if (!exva) throw new Error("window.exva is not available");
    return exva.session.getStatus();
  });
}
