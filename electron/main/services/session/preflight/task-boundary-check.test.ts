import { describe, expect, it } from "vitest";
import { taskBoundaryCheck } from "./task-boundary-check";

describe("taskBoundaryCheck", () => {
  const baseSession = {
    id: "session-1",
    name: "Paper Session",
    objective: "Trade NVDA",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "NVDA",
    executionMode: "paper_only",
  } as const;

  it("accepts a complete session boundary", async () => {
    const result = await taskBoundaryCheck(
      baseSession as never,
      {
        signalSourcesRepo: {
          subscribedSourceTypesForSession: () => ["edgar_8k"],
        },
        sessionSelectorSettingsRepo: {
          get: () => ({ aiPickerEnabled: false }),
        },
        sessionBrokerAssignmentsRepo: {
          listBrokerAccountIds: () => ["broker-1"],
        },
        brokerAccountsRepo: {
          find: () => ({
            id: "broker-1",
            supportedInstrumentClasses: ["stock"],
          }),
        },
      } as never,
    );

    expect(result).toEqual({ ok: true });
  });

  it("requires name, objective, instrument classes, and execution mode", async () => {
    const deps = {
      signalSourcesRepo: { subscribedSourceTypesForSession: () => [] },
      sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: false }) },
      sessionBrokerAssignmentsRepo: {
        listBrokerAccountIds: () => ["broker-1"],
      },
      brokerAccountsRepo: {
        find: () => ({
          id: "broker-1",
          supportedInstrumentClasses: ["stock"],
        }),
      },
    } as never;

    expect(
      await taskBoundaryCheck({ ...baseSession, name: "  " } as never, deps),
    ).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Session name is required.",
    });
    expect(
      await taskBoundaryCheck({ ...baseSession, objective: "" } as never, deps),
    ).toMatchObject({
      ok: false,
      message: "Session objective is required.",
    });
    expect(
      await taskBoundaryCheck(
        { ...baseSession, instrumentClasses: [] } as never,
        deps,
      ),
    ).toMatchObject({
      ok: false,
      message: "At least one instrument class is required.",
    });
    expect(
      await taskBoundaryCheck(
        { ...baseSession, executionMode: undefined } as never,
        deps,
      ),
    ).toMatchObject({
      ok: false,
      message: "Execution mode is required.",
    });
  });

  it("requires instrument scope for scan_hit experiences with no scope", async () => {
    // rules-breakout uses scan_hit (no signal source types) so scope is required.
    const result = await taskBoundaryCheck(
      { ...baseSession, instrumentScope: "", experienceId: "rules-breakout" } as never,
      {
        sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: true }) },
        sessionBrokerAssignmentsRepo: {
          listBrokerAccountIds: () => ["broker-1"],
        },
        brokerAccountsRepo: {
          find: () => ({
            id: "broker-1",
            supportedInstrumentClasses: ["stock"],
          }),
        },
      } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Instrument scope is required.",
    });
  });

  it("does not require instrument scope for event-driven experience sessions", async () => {
    // edgar-catalyst uses edgar_8k sources which are self-describing (no scope needed).
    const result = await taskBoundaryCheck(
      { ...baseSession, instrumentScope: "", experienceId: "edgar-catalyst" } as never,
      {
        sessionSelectorSettingsRepo: { get: () => ({ aiPickerEnabled: true }) },
        sessionBrokerAssignmentsRepo: {
          listBrokerAccountIds: () => ["broker-1"],
        },
        brokerAccountsRepo: {
          find: () => ({
            id: "broker-1",
            supportedInstrumentClasses: ["stock"],
          }),
        },
      } as never,
    );

    expect(result).toMatchObject({ ok: true });
  });
});
