import { describe, expect, it } from "vitest";
import { instrumentConflictCheck } from "./instrument-conflict-check";

describe("instrumentConflictCheck", () => {
  it("allows listener-only sessions to start without manual symbols", async () => {
    const result = await instrumentConflictCheck(
      {
        id: "session-1",
        selectionMode: "manual_shortlist",
        instrumentScope: "",
      } as never,
      {
        signalSourcesRepo: {
          subscribedSourceTypesForSession: () => ["edgar_8k"],
        },
      } as never,
    );

    expect(result).toEqual({ ok: true });
  });
});
