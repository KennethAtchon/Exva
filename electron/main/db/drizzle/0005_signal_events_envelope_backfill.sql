-- Backfill any remaining null envelope fields on signal_events.
-- After this, bus dedupe is solely by dedupe_key (accession dual-read removed).
-- Top-level EDGAR columns (accession_number, company_name, document_url, filed_at)
-- and payload_v2 are retained: still read by repos/UI/delivery paths as first-class fields.
UPDATE `signal_events` SET
  `dedupe_key` = COALESCE(
    `dedupe_key`,
    `accession_number`,
    COALESCE(`source_id`, 'unknown') || ':' || `ticker` || ':' || `detected_at`
  ),
  `kind` = COALESCE(
    `kind`,
    CASE
      WHEN `source_type` = 'edgar_8k' THEN 'filing'
      WHEN `source_type` = 'prediction_event' THEN 'market_dislocation'
      WHEN `source_type` = 'timer' THEN 'scan_hit'
      WHEN `source_type` = 'web_search' THEN 'news'
      ELSE 'manual'
    END
  ),
  `ttl` = COALESCE(`ttl`, 'PT4H'),
  `occurred_at` = COALESCE(`occurred_at`, `filed_at`, `detected_at`)
WHERE `dedupe_key` IS NULL
   OR `kind` IS NULL
   OR `ttl` IS NULL
   OR `occurred_at` IS NULL;
