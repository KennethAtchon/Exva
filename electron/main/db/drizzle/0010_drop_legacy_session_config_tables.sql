-- Marker migration: DROP of fourteen legacy session-config / preset tables
-- runs in TypeScript AFTER 0009 backfill (electron/main/db/drop-legacy-session-config-tables.ts).
-- Order: migrate → seed → backfill (reads old tables if present) → drop old tables.
-- session_templates is intentionally retained (template:* IPC / SessionTemplatesModal).
SELECT 1;
