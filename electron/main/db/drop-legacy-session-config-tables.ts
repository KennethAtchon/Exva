import type Database from "better-sqlite3";

/**
 * Tables removed by config-diet T5. Drop dependents first (phase workers),
 * then per-session config, then preset tables. session_templates is kept.
 */
export const LEGACY_SESSION_CONFIG_TABLES = [
  "session_ai_phase_workers",
  "session_ai_phases",
  "session_ai_settings",
  "session_selector_settings",
  "session_strategies",
  "session_research_posture",
  "session_trade_rules",
  "session_risk_config",
  "session_timeframe_config",
  "global_presets",
  "risk_presets",
  "timeframe_presets",
  "research_posture_presets",
  "trade_rule_presets",
] as const;

/**
 * Idempotent DROP after 0009 backfill — safe when tables already gone.
 * Callers must run assertSessionStrategyConfigPreservation first (inside the
 * same transaction as the backfill).
 */
export function dropLegacySessionConfigTables(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = OFF");
  try {
    for (const name of LEGACY_SESSION_CONFIG_TABLES) {
      sqlite.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
