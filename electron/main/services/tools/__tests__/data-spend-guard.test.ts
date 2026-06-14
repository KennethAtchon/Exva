import { describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { assertSessionDataSpendAvailable } from "../data-spend-guard";

describe("assertSessionDataSpendAvailable", () => {
  it("allows calls when no max data spend is configured", () => {
    const apiCallLogRepo = {
      dailyDataSpendUsd: vi.fn().mockReturnValue(999),
    };

    expect(() =>
      assertSessionDataSpendAvailable({
        sessionId: "s1",
        apiCallLogRepo: apiCallLogRepo as never,
        maxDataSpendUsd: null,
      }),
    ).not.toThrow();
  });

  it("blocks calls when daily data spend has reached the cap", () => {
    const apiCallLogRepo = {
      dailyDataSpendUsd: vi.fn().mockReturnValue(5),
    };

    try {
      assertSessionDataSpendAvailable({
        sessionId: "s1",
        apiCallLogRepo: apiCallLogRepo as never,
        maxDataSpendUsd: 5,
      });
      throw new Error("expected spend guard to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
  });

  it("allows calls when spend is below the cap", () => {
    const apiCallLogRepo = {
      dailyDataSpendUsd: vi.fn().mockReturnValue(4.99),
    };

    expect(() =>
      assertSessionDataSpendAvailable({
        sessionId: "s1",
        apiCallLogRepo: apiCallLogRepo as never,
        maxDataSpendUsd: 5,
      }),
    ).not.toThrow();
  });
});
