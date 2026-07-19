import { describe, expect, it } from "vitest";
import { isCapabilityAutoApproved } from "../build-control-toolset";

describe("isCapabilityAutoApproved", () => {
  it("matches the capability key (per-action auto-approve)", () => {
    const approved = new Set(["start_session"]);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "start_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(true);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "pause_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(false);
  });

  it("falls back to legacy confirmClass keys", () => {
    const approved = new Set(["session_lifecycle"]);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "start_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(true);
    expect(
      isCapabilityAutoApproved(approved, {
        key: "create_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(true);
  });

  it("returns false when neither key nor class is approved", () => {
    expect(
      isCapabilityAutoApproved(new Set(["other_capability"]), {
        key: "start_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(false);
  });

  it("returns false for empty auto-approved set", () => {
    expect(
      isCapabilityAutoApproved(new Set(), {
        key: "start_session",
        confirmClass: "session_lifecycle",
      }),
    ).toBe(false);
  });
});
