-- Marker migration: Zod-validated backfill of session_strategy_configs +
-- config_presets runs in TypeScript after drizzle migrate + seed
-- (electron/main/db/session-strategy-config-backfill.ts).
-- Idempotent; aborts loudly on any session/preset that fails validation.
SELECT 1;
