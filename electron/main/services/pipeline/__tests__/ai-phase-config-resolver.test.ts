import { describe, expect, it, vi } from "vitest";
import type { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import { AIPhaseConfigResolver } from "../ai-phase-config-resolver";

describe("AIPhaseConfigResolver", () => {
  const repo = {
    getByPhase: vi.fn(),
    getWorker: vi.fn(),
  } as unknown as SessionAiPhasesRepo;
  const resolver = new AIPhaseConfigResolver(repo);

  it("falls back to defaults when session phase config is missing", () => {
    vi.mocked(repo.getByPhase).mockReturnValue(null);

    expect(resolver.resolvePhaseConfig("s1", "technical")).toEqual({
      providerKey: "",
      modelId: "",
      temperature: 0.7,
      maxTokens: 8_192,
      reasoningLevel: "off",
      promptSource: "default",
      promptMarkdown: "",
    });
  });

  it("merges worker overrides onto phase config", () => {
    vi.mocked(repo.getByPhase).mockReturnValue({
      providerKey: "anthropic",
      modelId: "claude-sonnet",
      temperature: 0.5,
      maxTokens: 4096,
      reasoningLevel: "medium",
      promptSource: "default",
      promptMarkdown: "phase prompt",
    } as never);
    vi.mocked(repo.getWorker).mockReturnValue({
      providerKey: "openai",
      modelId: "gpt-4.1",
      promptMarkdown: "worker prompt",
      maxSteps: 12,
      spendLimitUsd: 0.25,
    } as never);

    const config = resolver.resolveWorkerExecConfig(
      "s1",
      "technical",
      "chart-analyst",
    );

    expect(config.providerKey).toBe("openai");
    expect(config.modelId).toBe("gpt-4.1");
    expect(config.promptMarkdown).toBe("worker prompt");
    expect(config.workerOverride).not.toBeNull();
  });

  it("applies sandbox selector caps when resolving runtime config", () => {
    const worker = {
      id: "selector-discovery",
      prompt: "discover",
      tools: [],
      strategyContext: { fields: [], guidance: [] },
      outputMode: "text",
    } as const;

    const sandbox = resolver.resolveWorkerRuntimeConfig(
      "selector",
      worker,
      null,
      true,
    );
    const live = resolver.resolveWorkerRuntimeConfig(
      "selector",
      worker,
      null,
      false,
    );

    expect(sandbox.caps.spendLimitUsd).toBeGreaterThan(
      live.caps.spendLimitUsd ?? 0,
    );
  });

  it("resolves phase spend caps for sandbox and live profiles", () => {
    expect(resolver.resolvePhaseSpendCapUsd("selector", true)).toBeGreaterThan(
      0,
    );
    expect(resolver.resolvePhaseSpendCapUsd("decision", false)).toBeGreaterThan(
      0,
    );
  });
});
