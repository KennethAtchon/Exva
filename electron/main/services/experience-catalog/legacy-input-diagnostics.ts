import type { DbClient } from "../../db/client";
import { signalSources } from "../../db/schema";

// ---------------------------------------------------------------------------
// Category types
// ---------------------------------------------------------------------------

export type LegacySourceCategory =
  | "event"      // edgar_8k, prediction_event — real external event feeds
  | "timer"      // timer — scheduled scan sources
  | "mock"       // mock — test/rehearsal sources
  | "manual"     // manual — implicit manual ticker sources
  | "unknown";   // unrecognised or unmapped type

export interface ClassifiedSignalSource {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  experienceId: string | null;
  category: LegacySourceCategory;
}

export interface LegacyInputReport {
  total: number;
  byCategory: Record<LegacySourceCategory, ClassifiedSignalSource[]>;
  summary: Record<LegacySourceCategory, number>;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const EVENT_TYPES = new Set(["edgar_8k", "prediction_event", "web_search"]);
const TIMER_TYPES = new Set(["timer"]);
const MOCK_TYPES = new Set(["mock"]);
const MANUAL_TYPES = new Set(["manual"]);

export function classifySignalSourceRow(row: {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  experienceId: string | null | undefined;
}): ClassifiedSignalSource {
  let category: LegacySourceCategory;
  if (EVENT_TYPES.has(row.type)) {
    category = "event";
  } else if (TIMER_TYPES.has(row.type)) {
    category = "timer";
  } else if (MOCK_TYPES.has(row.type)) {
    category = "mock";
  } else if (MANUAL_TYPES.has(row.type)) {
    category = "manual";
  } else {
    category = "unknown";
  }

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    experienceId: row.experienceId ?? null,
    category,
  };
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Classify all legacy `signal_sources` rows into categories and return a
 * summary report. Useful for Phase 0 migration diagnostics.
 */
export function buildLegacyInputReport(db: DbClient): LegacyInputReport {
  const rows = db.db.select().from(signalSources).all();

  const classified = rows.map(classifySignalSourceRow);

  const byCategory: Record<LegacySourceCategory, ClassifiedSignalSource[]> = {
    event: [],
    timer: [],
    mock: [],
    manual: [],
    unknown: [],
  };

  for (const item of classified) {
    byCategory[item.category].push(item);
  }

  const summary = Object.fromEntries(
    Object.entries(byCategory).map(([cat, items]) => [cat, items.length]),
  ) as Record<LegacySourceCategory, number>;

  return {
    total: classified.length,
    byCategory,
    summary,
  };
}
