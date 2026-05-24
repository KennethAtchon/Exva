import {
  isSearchEverythingScope,
  parseSearchEverythingFocusInstrumentClass,
} from "@electron/shared/instruments/session-instrument-classes";
import { registerEngine, type InputEngine } from "../registry";

const selectorScopeInputEngine: InputEngine = {
  id: "selector-scope",
  kind: "input",
  build(ctx) {
    const { session, instrumentClasses } = ctx;

    if (isSearchEverythingScope(session.instrumentScope)) {
      const focusInstrumentClass = parseSearchEverythingFocusInstrumentClass(
        session.instrumentScope,
      );
      return Promise.resolve(
        [
          "Selector mode: full-universe discovery.",
          `Search across the full tradable universe for these broker-backed classes: ${instrumentClasses.join(", ")}.`,
          focusInstrumentClass
            ? `Focus discovery on ${focusInstrumentClass}. Prioritize that class unless a stronger, tool-backed case for another enabled class is explicitly justified.`
            : null,
          "Start broad, enumerate all serious candidate instruments you discover, and then research each candidate online before you rank it.",
          "Use live discovery/search evidence for every candidate you keep. Do not rely on memory-only ticker recall.",
          "Verify tradability with the market tools before submitting a candidate. Exclude anything that has no broker coverage or cannot be verified.",
          "Return ranked candidates through the selector pipeline output. Strongest setups first, up to the configured maximum.",
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
      );
    }

    return Promise.resolve(session.instrumentScope);
  },
};

registerEngine(selectorScopeInputEngine);
