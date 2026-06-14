import { describe, expect, it } from "vitest";
import {
  deriveSessionInputModel,
  deriveSessionReadiness,
  formatInstrumentOriginLabel,
  formatReadinessSummary,
  formatSelectionModeChip,
  formatSignalSourceTypeLabel,
  resolveSelectionModeForInput,
  sessionIsWaitingForLiveInputs,
  showInstrumentScopeControls,
} from "../session-input-model";

describe("session-input-model", () => {
  it("treats subscribed edgar source as listener input model", () => {
    expect(
      deriveSessionInputModel({
        subscribedSources: [{ type: "edgar_8k" }],
        instrumentScope: "",
      }),
    ).toBe("listener");
  });

  it("does not show instrument scope controls for listener sessions once loaded", () => {
    expect(
      showInstrumentScopeControls({
        inputModel: "listener",
        sourcesLoaded: true,
      }),
    ).toBe(false);
  });

  it("does not mark active listener sessions as waiting for live inputs", () => {
    const readiness = deriveSessionReadiness({
      subscribedSources: [{ enabled: true }],
      instrumentScope: "",
    });
    expect(sessionIsWaitingForLiveInputs({ status: "active", readiness })).toBe(
      false,
    );
  });

  it("marks active sessions with no inputs as waiting", () => {
    expect(
      sessionIsWaitingForLiveInputs({
        status: "active",
        readiness: "no_inputs",
      }),
    ).toBe(true);
  });

  it("formats listener readiness without manual ticker counts", () => {
    expect(
      formatReadinessSummary({
        readiness: "armed",
        inputModel: "listener",
        subscribedSources: [
          {
            id: "edgar-catalyst-signal",
            name: "EDGAR 8-K catalyst drift",
            type: "edgar_8k",
            enabled: true,
          },
        ],
        manualTickerCount: 0,
      }),
    ).toBe("Live input: EDGAR 8-K catalyst drift (EDGAR 8-K)");
  });

  it("resolves signal_driven selection mode for listener sessions", () => {
    expect(
      resolveSelectionModeForInput({
        subscribedSources: [{ type: "timer" }],
        instrumentScope: "",
        selectorSettings: { aiPickerEnabled: true },
      }),
    ).toBe("signal_driven");
  });

  it("formats signal-driven chip copy from the source type", () => {
    expect(
      formatSelectionModeChip({
        selectionMode: "signal_driven",
        experienceSignalSourceType: "edgar_8k",
      }),
    ).toEqual({
      label: "Signals",
      tooltip: "Instruments come from the subscribed edgar 8-k feed.",
    });
  });

  it("formats timer instrument origin labels", () => {
    expect(
      formatInstrumentOriginLabel({
        inputModel: "listener",
        experienceSignalSourceType: "timer",
        timerSymbol: "SPY",
        timerCadence: "15m",
        instrumentScope: "",
      }),
    ).toBe("SPY @ 15m (timer)");
  });

  it("labels all signal source types", () => {
    expect(formatSignalSourceTypeLabel("prediction_event")).toBe(
      "Prediction Event",
    );
  });
});
