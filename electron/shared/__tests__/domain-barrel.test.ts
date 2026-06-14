import { describe, expect, it } from "vitest";
import * as barrel from "../domain";
import * as enums from "../domain/enums";
import * as session from "../domain/session";
import * as signals from "../domain/signals";
import * as trade from "../domain/trade";
import * as workspace from "../domain/workspace";
import * as experience from "../domain/experience";
import * as mockScenario from "../domain/mock-scenario";
import * as signalDeadLetters from "../domain/signal-dead-letters";
import * as signalSourceCapabilities from "../domain/signal-source-capabilities";
import * as predictionEventTriggers from "../domain/prediction-event-triggers";

const BARREL_EXPORTS: Record<string, unknown> = barrel;

describe("domain.ts barrel exports", () => {
  const requiredSymbols = [
    "canTransition",
    "isSessionEditable",
    "buildStrategyTimeframeContext",
    "validateSessionStrategyTimeframeFields",
    "isSearchStyleSignalSourceType",
    "SIGNAL_SOURCE_CAPABILITIES",
    "extractSignalInstrumentClass",
    "MOCK_SCENARIO_KINDS",
    "PREDICTION_EVENT_TRIGGER_LABELS",
  ] as const;

  it.each(requiredSymbols)("re-exports %s from domain modules", (symbol) => {
    expect(BARREL_EXPORTS[symbol]).toBeDefined();
  });

  it("matches key enum exports from enums module", () => {
    expect(barrel.canTransition).toBe(enums.canTransition);
    expect(barrel.isSessionEditable).toBe(enums.isSessionEditable);
  });

  it("matches key session exports", () => {
    expect(barrel.buildStrategyTimeframeContext).toBe(
      session.buildStrategyTimeframeContext,
    );
  });

  it("matches key signals exports", () => {
    expect(barrel.isSearchStyleSignalSourceType).toBe(
      signals.isSearchStyleSignalSourceType,
    );
  });

  it("does not drift from direct module imports for trade/workspace types", () => {
    expect(typeof trade).toBe("object");
    expect(typeof workspace).toBe("object");
    expect(typeof experience).toBe("object");
    expect(typeof mockScenario).toBe("object");
    expect(typeof signalDeadLetters).toBe("object");
    expect(typeof signalSourceCapabilities).toBe("object");
    expect(typeof predictionEventTriggers).toBe("object");
  });
});
