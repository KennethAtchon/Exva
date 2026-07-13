import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config-defaults";

vi.mock("@/lib/exva", () => ({
  api: {
    getStrategyConfig: vi.fn(),
    getStrategy: vi.fn(),
    listStrategyConfigPresets: vi.fn(),
    updateStrategyConfig: vi.fn(),
    applyStrategyConfigPreset: vi.fn(),
    getStrategyConfigHistory: vi.fn(),
    rollbackStrategyConfig: vi.fn(),
  },
}));

import { api } from "@/lib/exva";
import { useStrategyStore } from "@/store/strategyStore";
import { staleVersionUserMessage } from "@/lib/strategy-config-ui";

const baseDoc = defaultSessionStrategyConfigDoc();

function mockPage() {
  return {
    researchPosture: {
      sessionId: "s1",
      ...baseDoc.researchPosture,
      updatedAt: "t",
    },
    rules: { sessionId: "s1", ...baseDoc.tradeRules, updatedAt: "t" },
    riskConfig: { sessionId: "s1", ...baseDoc.risk, updatedAt: "t" },
    timeframe: { sessionId: "s1", ...baseDoc.timeframe, updatedAt: "t" },
    aiSettings: {
      sessionId: "s1",
      ...baseDoc.ai.settings,
      updatedAt: "t",
    },
    selectorSettings: {
      sessionId: "s1",
      ...baseDoc.selector,
      updatedAt: "t",
    },
    providers: [],
    sessionStatus: "idle" as const,
    selectionMode: "manual_shortlist" as const,
    defaultSearchProviderId: null,
    workspaceDefaultSearchProviderId: null,
    workspaceDefaultModelProviderKey: "openai",
    workspaceDefaultModelModelId: "gpt-4.1",
    aiPhases: [],
  };
}

describe("strategyStore document API", () => {
  beforeEach(() => {
    useStrategyStore.setState({
      configVersion: null,
      researchPosture: null,
      rules: null,
      riskConfig: null,
      timeframe: null,
      aiSettings: null,
      providers: [],
      selectorSettings: null,
      selectionMode: null,
      defaultSearchProviderId: null,
      workspaceDefaultSearchProviderId: null,
      workspaceDefaultModelProviderKey: "",
      workspaceDefaultModelModelId: "",
      aiPhases: [],
      globalPresets: [],
      dirtyFields: new Set(),
      activeSection: "style",
      strategyErrors: [],
      isSaving: false,
      isLocked: false,
      state: "no_session",
    });
    vi.mocked(api.getStrategyConfig).mockReset();
    vi.mocked(api.getStrategy).mockReset();
    vi.mocked(api.listStrategyConfigPresets).mockReset();
    vi.mocked(api.updateStrategyConfig).mockReset();
    vi.mocked(api.applyStrategyConfigPreset).mockReset();
  });

  it("loads versioned config via strategyConfig.get + listPresets", async () => {
    vi.mocked(api.getStrategyConfig).mockResolvedValue({
      version: 3,
      schemaVersion: 1,
      doc: baseDoc,
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    vi.mocked(api.getStrategy).mockResolvedValue(mockPage() as never);
    vi.mocked(api.listStrategyConfigPresets).mockResolvedValue({
      presets: [
        {
          id: "full/demo",
          name: "Demo",
          kind: "full",
          doc: baseDoc,
          builtin: true,
          updatedAt: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    await useStrategyStore.getState().loadStrategy("s1");

    expect(api.getStrategyConfig).toHaveBeenCalledWith("s1");
    expect(api.listStrategyConfigPresets).toHaveBeenCalledWith("full");
    expect(useStrategyStore.getState().configVersion).toBe(3);
    expect(useStrategyStore.getState().riskConfig?.maxPositionUsd).toBe(
      baseDoc.risk.maxPositionUsd,
    );
    expect(useStrategyStore.getState().globalPresets).toHaveLength(1);
  });

  it("saves a single document patch with expectedVersion", async () => {
    vi.mocked(api.getStrategyConfig).mockResolvedValue({
      version: 1,
      schemaVersion: 1,
      doc: baseDoc,
      updatedAt: "t0",
    });
    vi.mocked(api.getStrategy).mockResolvedValue(mockPage() as never);
    vi.mocked(api.listStrategyConfigPresets).mockResolvedValue({
      presets: [],
    });
    await useStrategyStore.getState().loadStrategy("s1");

    useStrategyStore.getState().updateRiskConfig({ maxPositionUsd: 777 });
    vi.mocked(api.updateStrategyConfig).mockResolvedValue({
      version: 2,
      schemaVersion: 1,
      doc: {
        ...baseDoc,
        risk: { ...baseDoc.risk, maxPositionUsd: 777 },
      },
      updatedAt: "t1",
    });

    await useStrategyStore.getState().saveAll("s1");

    expect(api.updateStrategyConfig).toHaveBeenCalledWith({
      sessionId: "s1",
      expectedVersion: 1,
      patch: expect.objectContaining({
        risk: expect.objectContaining({ maxPositionUsd: 777 }),
      }),
    });
    expect(useStrategyStore.getState().configVersion).toBe(2);
    expect(useStrategyStore.getState().dirtyFields.size).toBe(0);
  });

  it("surfaces STALE_VERSION and reloads instead of overwriting", async () => {
    vi.mocked(api.getStrategyConfig)
      .mockResolvedValueOnce({
        version: 1,
        schemaVersion: 1,
        doc: baseDoc,
        updatedAt: "t0",
      })
      .mockResolvedValueOnce({
        version: 2,
        schemaVersion: 1,
        doc: {
          ...baseDoc,
          risk: { ...baseDoc.risk, maxPositionUsd: 50 },
        },
        updatedAt: "t2",
      });
    vi.mocked(api.getStrategy).mockResolvedValue(mockPage() as never);
    vi.mocked(api.listStrategyConfigPresets).mockResolvedValue({
      presets: [],
    });
    await useStrategyStore.getState().loadStrategy("s1");

    useStrategyStore.getState().updateRiskConfig({ maxPositionUsd: 999 });
    const stale = Object.assign(new Error("version mismatch"), {
      code: "STALE_VERSION",
    });
    vi.mocked(api.updateStrategyConfig).mockRejectedValue(stale);

    await useStrategyStore.getState().saveAll("s1");

    expect(useStrategyStore.getState().strategyErrors).toEqual([
      staleVersionUserMessage(),
    ]);
    expect(useStrategyStore.getState().configVersion).toBe(2);
    expect(useStrategyStore.getState().riskConfig?.maxPositionUsd).toBe(50);
    expect(useStrategyStore.getState().dirtyFields.size).toBe(0);
  });
});
