import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "@/lib/types";
import { instrumentConflictCheck } from "./instrument-conflict-check";

function makeSession(
  overrides: Partial<WorkspaceSession> = {},
): WorkspaceSession {
  return {
    id: "session-b",
    name: "Session B",
    objective: "Trade NVDA",
    status: "draft",
    isFocused: false,
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "NVDA",
    defaultSearchProviderId: null,
    executionMode: "paper_only",
    experienceId: "edgar-catalyst",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("instrumentConflictCheck", () => {
  it("blocks the same symbol on the same broker while excluding the current session", async () => {
    const checkInstrumentConflict = vi.fn(
      (brokerAccountId: string, symbol: string, sessionId: string) =>
        brokerAccountId === "broker-x" &&
        symbol === "NVDA" &&
        sessionId === "session-b",
    );

    const result = await instrumentConflictCheck(makeSession(), {
      brokerRouting: {
        resolveBrokerAccountId: () => "broker-x",
      },
      signalSourcesRepo: {
        subscribedSourceTypesForSession: () => ["edgar_8k"],
      },
      tradesRepo: { checkInstrumentConflict },
    } as never);

    expect(result).toMatchObject({
      ok: false,
      code: "INSTRUMENT_CONFLICT",
      details: {
        symbol: "NVDA",
        instrumentClass: "stock",
        brokerAccountId: "broker-x",
      },
    });
    expect(checkInstrumentConflict).toHaveBeenCalledWith(
      "broker-x",
      "NVDA",
      "session-b",
    );
  });

  it("allows the same symbol on a different broker", async () => {
    const checkInstrumentConflict = vi.fn(
      (brokerAccountId: string, symbol: string) =>
        brokerAccountId === "broker-x" && symbol === "NVDA",
    );

    const result = await instrumentConflictCheck(makeSession(), {
      brokerRouting: {
        resolveBrokerAccountId: () => "broker-y",
      },
      signalSourcesRepo: {
        subscribedSourceTypesForSession: () => ["edgar_8k"],
      },
      tradesRepo: { checkInstrumentConflict },
    } as never);

    expect(result).toEqual({ ok: true });
    expect(checkInstrumentConflict).toHaveBeenCalledWith(
      "broker-y",
      "NVDA",
      "session-b",
    );
  });
});
