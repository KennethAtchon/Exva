import { describe, expect, it } from "vitest";
import { migrateEligibleSessionsToMockRehearsal } from "../migrate-mock-rehearsal-subscriptions";

describe("migrateEligibleSessionsToMockRehearsal", () => {
  it("is a no-op stub returning [] (V2: subscriptions managed by catalog)", () => {
    expect(migrateEligibleSessionsToMockRehearsal()).toEqual([]);
  });
});
