# Phase 0 — DB Migration & Schema

> **Date:** 2026-05-28
> **Status:** Todo
> **Spec sections:** §6.1, §6.2, §6.5, §6.6, §6.7
> **Depends on:** Nothing — this is the foundation
> **Unlocks:** Phase 1, Phase 2, Phase 3

---

## 1. Problem Statement

The current schema has no concept of signal sources, signal events, or per-session signal deliveries. The `session_research_posture` table uses `discovery_mode` and the `ResearchDiscoveryMode` enum — both of which are being replaced. The `sessions` table needs a `signal_driven` selection mode value. None of this is backward compatible with any existing data; there is no production data to preserve.

---

## 2. Goals

| #   | Goal                                             | Done When                                                         |
| --- | ------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | Create `signal_sources` table                    | Table exists, insertable via Drizzle schema                       |
| 2   | Create `signal_events` table                     | Table exists with unique index on `(source_id, accession_number)` |
| 3   | Create `session_signal_deliveries` table         | Table exists with cascade deletes wired                           |
| 4   | Create `session_signal_sources` join table       | Table exists with composite PK `(session_id, source_id)`          |
| 5   | Rename `discovery_mode` → `processing_mode`      | Column renamed; old values mapped to new enum                     |
| 6   | Add `signal_driven` to `sessions.selection_mode` | Enum/check accepts new value                                      |
| 7   | Drizzle schema files updated                     | `schema.ts` (or equivalent) reflects all new tables and changes   |
| 8   | Migration file created                           | `0003_signal_sources.sql` exists and runs clean                   |

---

## 3. New Tables

### 3.1 `signal_sources`

```sql
CREATE TABLE signal_sources (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK(type IN ('edgar_8k', 'web_search', 'manual')),
  name         TEXT NOT NULL,
  description  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  config_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

### 3.2 `signal_events`

```sql
CREATE TABLE signal_events (
  id                     TEXT PRIMARY KEY,
  source_id              TEXT NOT NULL REFERENCES signal_sources(id),
  source_type            TEXT NOT NULL,
  ticker                 TEXT NOT NULL,
  company_name           TEXT,
  document_url           TEXT,
  accession_number       TEXT,
  payload_json           TEXT NOT NULL DEFAULT '{}',
  filed_at               TEXT NOT NULL,
  detected_at            TEXT NOT NULL,
  dispatch_status        TEXT NOT NULL CHECK(dispatch_status IN ('new', 'fanned_out', 'dropped_pre_fanout')),
  dispatch_completed_at  TEXT,
  source_dropped_reason  TEXT
);

-- EDGAR dedup: unique accession_number per source when present
CREATE UNIQUE INDEX idx_signal_events_accession
  ON signal_events(source_id, accession_number)
  WHERE accession_number IS NOT NULL;
```

### 3.3 `session_signal_deliveries`

```sql
CREATE TABLE session_signal_deliveries (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_event_id           TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
  source_id                 TEXT NOT NULL,
  queue_position_at_enqueue INTEGER NOT NULL,
  status                    TEXT NOT NULL CHECK(status IN (
    'queued', 'waiting_for_resume', 'processing',
    'triggered', 'traded', 'rejected', 'dropped', 'expired'
  )),
  status_bucket             TEXT NOT NULL CHECK(status_bucket IN ('pending', 'completed', 'dropped')),
  enqueued_at               TEXT NOT NULL,
  started_at                TEXT,
  finished_at               TEXT,
  expires_at                TEXT,
  trade_id                  TEXT,
  drop_reason               TEXT,
  notes_json                TEXT
);

CREATE INDEX idx_ssd_session ON session_signal_deliveries(session_id);
CREATE INDEX idx_ssd_status  ON session_signal_deliveries(session_id, status_bucket);
```

### 3.4 `session_signal_sources` (join table)

```sql
CREATE TABLE session_signal_sources (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_id  TEXT NOT NULL REFERENCES signal_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, source_id)
);
```

---

## 4. Existing Table Changes

### 4.1 `session_research_posture` — rename column

```sql
-- Add new column
ALTER TABLE session_research_posture ADD COLUMN processing_mode TEXT;

-- Copy with value mapping
UPDATE session_research_posture SET processing_mode = CASE discovery_mode
  WHEN 'trend_scan'          THEN 'catalyst'
  WHEN 'catalyst_scan'       THEN 'catalyst'
  WHEN 'quality_watchlist'   THEN 'catalyst'
  WHEN 'mean_reversion_scan' THEN 'catalyst'
  WHEN 'event_contract_scan' THEN 'contract'
  WHEN 'custom'              THEN 'catalyst'
  ELSE 'catalyst'
END;

-- Drop old column (SQLite: requires recreate — handle via Drizzle migration)
```

**Note on SQLite column drop:** SQLite <3.35 requires table recreation to drop a column. Drizzle handles this via `migrate` — emit it as a new table + copy + drop old + rename. Confirm the Drizzle version in use supports `dropColumn` or fall back to manual migration SQL.

### 4.2 `sessions` — add `signal_driven` to selection_mode

The `selection_mode` column currently accepts `manual_shortlist | ai_selected_universe`. Add `signal_driven`.

```sql
-- SQLite check constraint cannot be altered; if the column has a CHECK constraint,
-- recreate the table with the updated constraint.
-- If no CHECK constraint exists, the INSERT will accept any text value — verify schema.
```

---

## 5. Drizzle Schema Updates

Files to update (confirm exact paths via `find electron -name "schema.ts" -o -name "*.schema.ts"`):

- Add `signalSources`, `signalEvents`, `sessionSignalDeliveries`, `sessionSignalSources` table definitions
- Update `sessionResearchPosture` to rename `discoveryMode` → `processingMode`
- Update `sessions` enum/union for `selectionMode`

Drizzle relations to add:

- `signal_sources` → `signal_events` (one-to-many)
- `signal_events` → `session_signal_deliveries` (one-to-many)
- `sessions` → `session_signal_sources` (many-to-many via join)
- `sessions` → `session_signal_deliveries` (one-to-many)

---

## 6. Migration File

Create: `electron/main/db/migrations/0003_signal_sources.sql`

Order of statements:

1. Create `signal_sources`
2. Create `signal_events` + index
3. Create `session_signal_deliveries` + indexes
4. Create `session_signal_sources`
5. Alter `session_research_posture` (add + update + drop old column)
6. Handle `sessions.selection_mode` constraint change if needed

---

## 7. Checklist

- [ ] Migration SQL written and reviewed
- [ ] Drizzle schema TypeScript definitions added
- [ ] `db:push` or `drizzle-kit generate` runs without errors
- [ ] Migration applies on a clean DB
- [ ] `processing_mode` column exists in `session_research_posture` with correct values
- [ ] `session_signal_sources` composite PK enforced (test duplicate insert → error)
- [ ] Unique index on `signal_events(source_id, accession_number)` enforced (test duplicate → error)
- [ ] Cascade deletes work: delete a session → deliveries deleted; delete a signal_event → deliveries deleted
