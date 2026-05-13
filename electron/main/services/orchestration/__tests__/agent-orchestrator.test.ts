import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "../agent-orchestrator";

describe("AgentOrchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the selector retry profile for both the timer and emitted message", () => {
    const deps = createDeps({ noInstrumentRetryMinutes: 7 });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(() => 1 as never);
    const orchestrator = new AgentOrchestrator("session-1", deps as never);

    (orchestrator as never as { handleResolvedInstruments: (rows: unknown[], context: string) => void }).handleResolvedInstruments(
      [],
      "Initial research cycle complete",
    );

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 7 * 60 * 1000);
    expect(deps.eventsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Initial research cycle complete; no tradable instruments were selected. Re-evaluating in 7 minutes.",
      }),
    );
  });

  it.each([
    { label: "profile is missing the setting", noInstrumentRetryMinutes: undefined },
    { label: "profile contains an out-of-range value", noInstrumentRetryMinutes: 0 },
  ])("falls back to the 5-minute default when $label", ({ noInstrumentRetryMinutes }) => {
    const deps = createDeps({ noInstrumentRetryMinutes });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(() => 1 as never);
    const orchestrator = new AgentOrchestrator("session-1", deps as never);

    (orchestrator as never as { handleResolvedInstruments: (rows: unknown[], context: string) => void }).handleResolvedInstruments(
      [],
      "Scheduled selector retry complete",
    );

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    expect(deps.eventsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Scheduled selector retry complete; no tradable instruments were selected. Re-evaluating in 5 minutes.",
      }),
    );
  });
});

function createDeps({ noInstrumentRetryMinutes }: { noInstrumentRetryMinutes?: number }) {
  return {
    strategyContextService: {
      get: () => ({
        aiRoleProfiles: [
          {
            role: "instrument_selector",
            profileJson:
              noInstrumentRetryMinutes == null
                ? { version: 1 }
                : { version: 1, selectorSettings: { noInstrumentRetryMinutes } },
          },
        ],
      }),
    },
    eventsRepo: {
      insert: vi.fn((event) => event),
    },
    bus: {
      emit: vi.fn(),
      runtimeStatus: vi.fn(() => "active"),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}
