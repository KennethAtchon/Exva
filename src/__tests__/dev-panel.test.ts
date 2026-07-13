import { describe, expect, it } from "vitest";
import { formatEventsForClipboard } from "@/hubs/panels/dev-panel";

describe("Developer Workbench", () => {
  it("formats filtered events for copying", () => {
    const copied = formatEventsForClipboard([
      {
        id: "event-1",
        session_id: "session-1",
        trade_id: null,
        cycle_id: "cycle-abcdef",
        level: "INFO",
        agent_type: "orchestrator",
        message: "Session stopped.",
        created_at: "2026-06-18T07:30:00.000Z",
      },
    ]);

    expect(copied).toContain("Developer Workbench Events");
    expect(copied).toContain("[INFO] [orchestrator] Session stopped.");
    expect(copied).toContain("cycle-abcdef");
    expect(copied).toContain('"id": "event-1"');
  });
});
