import { describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { SessionWriteService } from "../write-service";

describe("SessionWriteService config validation", () => {
  it("blocks non-sentinel sessions from blocked experiences", () => {
    const sessions = {
      list: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue({ id: "s1", name: "Test" }),
      setFocus: vi.fn(),
      updateTaskBoundary: vi.fn(),
    };
    const brokerAccounts = {
      list: vi.fn().mockReturnValue([
        {
          id: "b1",
          name: "Paper",
          mode: "paper",
          brokerType: "alpaca",
          supportedInstrumentClasses: ["futures"],
        },
      ]),
    };
    const service = new SessionWriteService({
      sessions: sessions as never,
      events: { insert: vi.fn() } as never,
      strategyContext: { saveSelectorSettings: vi.fn() } as never,
      assignments: { replaceAssignments: vi.fn() } as never,
      brokerRouting: { upsertSessionOverrides: vi.fn() } as never,
      brokerAccounts: brokerAccounts as never,
    });

    expect(() =>
      service.create({
        name: "Regular Session",
        objective: "test",
        selectionMode: "signal_driven",
        instrumentScope: "GC",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        brokerAssignments: [{ brokerAccountId: "b1", allocatedUsd: 1000 }],
        experienceId: "rules-trend-following",
      }),
    ).toThrow(AppError);
  });

  it("allows blocked experiences on sentinel sessions", () => {
    const sessions = {
      list: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue({ id: "s1", name: "FUTURES-INTEGRATION-SENTINEL" }),
      setFocus: vi.fn(),
      updateTaskBoundary: vi.fn(),
    };
    const brokerAccounts = {
      list: vi.fn().mockReturnValue([
        {
          id: "b1",
          name: "Mock",
          mode: "paper",
          brokerType: "mock",
          supportedInstrumentClasses: ["futures"],
        },
      ]),
    };
    const service = new SessionWriteService({
      sessions: sessions as never,
      events: { insert: vi.fn() } as never,
      strategyContext: { saveSelectorSettings: vi.fn() } as never,
      assignments: { replaceAssignments: vi.fn() } as never,
      brokerRouting: { upsertSessionOverrides: vi.fn() } as never,
      brokerAccounts: brokerAccounts as never,
    });

    const result = service.create({
      name: "FUTURES-INTEGRATION-SENTINEL",
      objective: "sentinel",
      selectionMode: "signal_driven",
      instrumentScope: "GC",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      brokerAssignments: [{ brokerAccountId: "b1", allocatedUsd: 1000 }],
      experienceId: "rules-trend-following",
    });
    expect(result.id).toBe("s1");
  });
});
