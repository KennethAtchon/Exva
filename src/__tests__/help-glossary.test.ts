import { describe, expect, it } from "vitest";
import { HELP_GLOSSARY, getHelpEntry } from "@/lib/help-glossary";

describe("help glossary", () => {
  it("contains the core glossary entries used across the workspace", () => {
    expect(HELP_GLOSSARY.experience.body.length).toBeGreaterThan(0);
    expect(HELP_GLOSSARY["environment-live"].title).toBe("Live environment");
    expect(HELP_GLOSSARY["session-status-monitoring-only"].body).toContain(
      "Existing positions",
    );
    expect(HELP_GLOSSARY["signal-type-edgar-8k"].body).toContain("8-K");
  });

  it("resolves glossary-backed help entries", () => {
    expect(getHelpEntry({ glossaryId: "approval-queue" })).toEqual({
      title: "Approval queue",
      body: "Trade proposals waiting for a human approve or reject decision before execution.",
    });
  });

  it("lets inline copy override the glossary", () => {
    expect(
      getHelpEntry({
        glossaryId: "approval-queue",
        title: "Custom title",
        body: "Custom body",
      }),
    ).toEqual({
      title: "Custom title",
      body: "Custom body",
    });
  });
});
