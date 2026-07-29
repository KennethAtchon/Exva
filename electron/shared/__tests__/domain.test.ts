import { describe, expect, it } from "vitest";
import { canTransition, isSessionEditable } from "../domain";

describe("domain session helpers", () => {
  it("rejects illegal session transitions", () => {
    expect(canTransition("archived", "active")).toBe(false);
    expect(canTransition("active", "archived")).toBe(false);
    expect(canTransition("idle", "paused")).toBe(false);
  });

  it("accepts legal session transitions", () => {
    expect(canTransition("draft", "idle")).toBe(true);
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("active", "monitoring_only")).toBe(true);
    expect(canTransition("paused", "monitoring_only")).toBe(true);
    expect(canTransition("monitoring_only", "stopped")).toBe(true);
    expect(canTransition("stopped", "archived")).toBe(true);
    expect(canTransition("stopped", "active")).toBe(true);
  });

  it("rejects resume from monitoring_only drain state", () => {
    expect(canTransition("monitoring_only", "active")).toBe(false);
  });

  it("locks active and paused sessions from edits", () => {
    expect(isSessionEditable("draft")).toBe(true);
    expect(isSessionEditable("idle")).toBe(true);
    expect(isSessionEditable("stopped")).toBe(true);
    expect(isSessionEditable("active")).toBe(false);
    expect(isSessionEditable("paused")).toBe(false);
    expect(isSessionEditable("monitoring_only")).toBe(false);
    expect(isSessionEditable("archived")).toBe(false);
  });
});
