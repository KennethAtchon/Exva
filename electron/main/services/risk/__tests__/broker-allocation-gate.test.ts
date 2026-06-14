import { describe, expect, it, vi } from "vitest";
import { BrokerAllocationGate } from "../broker-allocation-gate";

describe("BrokerAllocationGate", () => {
  const assignmentsRepo = {
    findAssignment: vi.fn(),
  };
  const tradesRepo = {
    sumOpenPositionSizeUsd: vi.fn(),
    findOpenTradeOnBroker: vi.fn(),
  };
  const workspacePrefsRepo = {
    get: vi.fn(),
  };
  const brokerAccountsRepo = {
    find: vi.fn(),
  };
  const gate = new BrokerAllocationGate(
    assignmentsRepo as never,
    tradesRepo as never,
    workspacePrefsRepo as never,
    brokerAccountsRepo as never,
  );

  it("allows orders when no broker assignment exists", () => {
    assignmentsRepo.findAssignment.mockReturnValue(null);
    expect(gate.checkOrderFits("broker-1", "s1", 500)).toEqual({ ok: true });
  });

  it("allows orders that fit within free allocation", () => {
    assignmentsRepo.findAssignment.mockReturnValue({ allocatedUsd: 1000 });
    tradesRepo.sumOpenPositionSizeUsd.mockReturnValue(400);
    expect(gate.checkOrderFits("broker-1", "s1", 500)).toEqual({ ok: true });
  });

  it("warns instead of blocking when enforcement is warn", () => {
    assignmentsRepo.findAssignment.mockReturnValue({ allocatedUsd: 500 });
    tradesRepo.sumOpenPositionSizeUsd.mockReturnValue(450);
    workspacePrefsRepo.get.mockReturnValue({
      allocationEnforcementOverride: "warn",
    });

    expect(gate.checkOrderFits("broker-1", "s1", 100)).toEqual({
      ok: true,
      warning: "over_allocated",
    });
  });

  it("blocks orders that exceed hard allocation limits", () => {
    assignmentsRepo.findAssignment.mockReturnValue({ allocatedUsd: 500 });
    tradesRepo.sumOpenPositionSizeUsd.mockReturnValue(450);
    workspacePrefsRepo.get.mockReturnValue({});
    brokerAccountsRepo.find.mockReturnValue({ allocationEnforcement: "hard" });

    const result = gate.checkOrderFits("broker-1", "s1", 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BROKER_ALLOCATION_EXHAUSTED");
      expect(result.reason).toMatch(/allocation exhausted/i);
    }
  });

  it("blocks instrument conflicts on the same broker", () => {
    tradesRepo.findOpenTradeOnBroker.mockReturnValue({ id: "trade-1" });
    const result = gate.checkInstrumentConflict("broker-1", "AAPL", "s2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INSTRUMENT_CONFLICT");
      expect(result.reason).toMatch(/already held/);
    }
  });
});
