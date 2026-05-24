/**
 * Canonical list of all registered AIPhase objects.
 *
 * This file has NO engine side effects — it only imports the phase definition
 * objects themselves. Importing from here is safe for the catalog, tests, and
 * any code that needs to iterate phases without triggering engine registration.
 *
 * Engine registration happens in definitions/index.ts (which imports engines/
 * as a side effect) and in each aggregator phase file (which imports its
 * finalizer engine). Call registerAllPhases() from definitions/index.ts at
 * boot to ensure all engines are registered before execution begins.
 */

import type { AIPhase } from "../phases/types";
import { DECISION_PHASE } from "./decision.phase";
import { FUNDAMENTAL_PHASE } from "./fundamental.phase";
import { REVIEW_PHASE } from "./review.phase";
import { SELECTOR_PHASE } from "./selector.phase";
import { TECHNICAL_PHASE } from "./technical.phase";

export const ALL_PHASES = [
  SELECTOR_PHASE,
  TECHNICAL_PHASE,
  FUNDAMENTAL_PHASE,
  REVIEW_PHASE,
  DECISION_PHASE,
] as const satisfies readonly AIPhase<unknown, unknown>[];
