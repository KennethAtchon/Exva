import { describe, expect, it } from "vitest";
import {
  isContinuousFuturesRoot,
  resolveFrontMonthContract,
} from "../futures-front-month";

describe("futures front-month roll", () => {
  it("resolves monthly GC to the next calendar month", () => {
    const code = resolveFrontMonthContract(
      "GC",
      new Date("2026-07-15T12:00:00.000Z"),
    );
    expect(code).toBe("GCQ26"); // August
  });

  it("resolves quarterly ES to the next quarter", () => {
    const code = resolveFrontMonthContract(
      "ES",
      new Date("2026-07-15T12:00:00.000Z"),
      { quarterly: true },
    );
    expect(code).toBe("ESU26"); // September
  });

  it("detects continuous roots", () => {
    expect(isContinuousFuturesRoot("GC")).toBe(true);
    expect(isContinuousFuturesRoot("AAPL")).toBe(false);
  });
});
