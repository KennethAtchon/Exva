import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/catalog/session-instrument-classes";
import type { InputBuilder } from "../input-builder-registry";

export const selectorScopeInputBuilder: InputBuilder = {
  id: "selector-scope",
  build(ctx) {
    const { session, instrumentClasses } = ctx;

    if (session.instrumentScope.trim() === SEARCH_EVERYTHING_SCOPE) {
      return Promise.resolve(
        [
          "Selector mode: full-universe discovery.",
          `Search across the full tradable universe for these broker-backed classes: ${instrumentClasses.join(", ")}.`,
          "Start broad, enumerate all serious candidate instruments you discover, and then research each candidate online before you rank it.",
          "Use live discovery/search evidence for every candidate you keep. Do not rely on memory-only ticker recall.",
          "Verify tradability with the market tools before submitting a candidate. Exclude anything that has no broker coverage or cannot be verified.",
          "Return ranked candidates through the selector pipeline output. Strongest setups first, up to the configured maximum.",
        ].join("\n"),
      );
    }

    return Promise.resolve(session.instrumentScope);
  },
};
