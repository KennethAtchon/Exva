import { describe, expect, it } from "vitest";
import { getUsEquitySession } from "../us-equity-session";

describe("getUsEquitySession", () => {
  it("classifies regular trading hours", () => {
    // Friday 2026-06-12, 10:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T14:00:00Z"))).toBe("regular");
  });

  it("classifies the pre-market extended window", () => {
    // Friday 2026-06-12, 05:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T09:00:00Z"))).toBe(
      "extended",
    );
  });

  it("classifies the post-market extended window", () => {
    // Friday 2026-06-12, 18:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T22:00:00Z"))).toBe(
      "extended",
    );
  });

  it("treats the overnight gap as closed", () => {
    // Friday 2026-06-12, 02:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T06:00:00Z"))).toBe("closed");
  });

  it("treats weekends as closed", () => {
    // Saturday 2026-06-13, 10:00 ET.
    expect(getUsEquitySession(new Date("2026-06-13T14:00:00Z"))).toBe("closed");
  });

  it("treats US market holidays as closed even during regular hours", () => {
    // Juneteenth (observed) 2026-06-19, 11:00 ET.
    expect(getUsEquitySession(new Date("2026-06-19T15:00:00Z"))).toBe("closed");
  });
});
