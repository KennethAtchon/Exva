import { describe, expect, it } from "vitest";
import { isCapabilityAutoApproved } from "../build-control-toolset";

describe("isCapabilityAutoApproved", () => {
  it("matches the capability key (per-action auto-approve)", () => {
    const approved = new Set(["start_session"]);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "start_session",
      }),
    ).toBe(true);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "pause_session",
      }),
    ).toBe(false);
  });

  it("does not approve a different capability in the same class", () => {
    const approved = new Set(["session_lifecycle"]);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "start_session",
      }),
    ).toBe(false);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "create_session",
      }),
    ).toBe(false);
  });

  it("returns false when neither key nor class is approved", () => {
    expect(
      isCapabilityAutoApproved(new Set(["other_capability"]), {
        key: "start_session",
      }),
    ).toBe(false);
  });

  it("returns false for empty auto-approved set", () => {
    expect(
      isCapabilityAutoApproved(new Set(), {
        key: "start_session",
      }),
    ).toBe(false);
  });
});
