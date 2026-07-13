import { describe, expect, it } from "vitest";
import type { SignalSourceType } from "@electron/shared/domain";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolveMockRehearsalTicker,
  resolveMockRehearsalTickerFromBrokers,
  sessionEligibleForMockRehearsal,
  sessionSubscribedToMockRehearsal,
} from "../mock-rehearsal";

describe("mock-rehearsal", () => {
  it("resolves ticker from scenario kind", () => {
    expect(resolveMockRehearsalTicker("clean_breakout")).toBe("NVDA");
    expect(resolveMockRehearsalTicker("sideways_chop")).toBe("SPY");
  });

  it("resolves ticker from first assigned mock broker", () => {
    expect(
      resolveMockRehearsalTickerFromBrokers(
        [
          {
            id: "mock-a",
            brokerType: "mock",
            mockScenarioKind: "failed_breakout",
          },
        ],
        ["mock-a"],
      ),
    ).toBe("AAPL");
  });

  it("requires all assigned brokers to be mock", () => {
    const experience = {
      signalSourceTypes: ["edgar_8k", "mock"] as SignalSourceType[],
    };
    const brokers = [
      {
        id: "mock-a",
        brokerType: "mock",
        mockScenarioKind: "clean_breakout" as const,
      },
      { id: "alpaca-a", brokerType: "alpaca", mockScenarioKind: null },
    ];

    expect(
      sessionEligibleForMockRehearsal({
        experience,
        brokerAccounts: brokers,
        brokerAssignmentIds: ["mock-a"],
      }),
    ).toBe(true);

    expect(
      sessionEligibleForMockRehearsal({
        experience,
        brokerAccounts: brokers,
        brokerAssignmentIds: ["mock-a", "alpaca-a"],
      }),
    ).toBe(false);
  });

  it("requires experience mock capability", () => {
    expect(
      sessionEligibleForMockRehearsal({
        experience: { signalSourceTypes: ["manual"] },
        brokerAccounts: [{ id: "mock-a", brokerType: "mock" }],
        brokerAssignmentIds: ["mock-a"],
      }),
    ).toBe(false);
  });

  it("detects mock rehearsal subscription by id and type", () => {
    expect(
      sessionSubscribedToMockRehearsal([
        { id: MOCK_REHEARSAL_SIGNAL_SOURCE_ID, type: "mock" },
      ]),
    ).toBe(true);
    expect(
      sessionSubscribedToMockRehearsal([{ id: "other-mock", type: "mock" }]),
    ).toBe(false);
  });
});
