-- Purge deprecated signal_sources rows (type IN ('timer','web_search')).
--
-- session_signal_sources was DROPPED in 0003_dear_tenebrous.sql. Do not reference it.
-- Fanout identity now lives in session_input_subscriptions.source_definition_id
-- (V2 source-definition ids). Abort if any subscription still points at a
-- timer/web_search signal_sources.id before delete.
--
-- Historical signal_events with source_type timer/web_search are LEFT intact:
-- after 0003 there is no FK from signal_events.source_id → signal_sources, and
-- repo reads cast source_type without a Zod enum reject.
--
-- Former live-source → V2 definition mapping (inlined for history; runtime now
-- uses resolveSourceDefinitionId in resolve-source-definition-id.ts):
--   sourceId ∈ SOURCE_DEFINITION_IDS                      → that id
--   'edgar-catalyst/edgar-8k-catalyst'                    → source-def/edgar-8k-catalyst
--   'prediction-event-edge/prediction-event-edge'         → source-def/prediction-event-edge
--   sourceId includes 'mock' OR sourceType = 'mock'       → source-def/mock-rehearsal
--   sourceType = 'edgar_8k'                               → source-def/edgar-8k-catalyst
--   sourceType = 'prediction_event'                       → source-def/prediction-event-edge
--   manual / unknown                                      → null (no fanout definition)

-- Abort if V2 subscriptions still reference deprecated source rows.
CREATE TEMP TABLE `_assert_no_deprecated_source_refs` (`x` INTEGER);--> statement-breakpoint
CREATE TEMP TRIGGER `_assert_no_deprecated_source_refs_trg`
BEFORE INSERT ON `_assert_no_deprecated_source_refs`
BEGIN
  SELECT RAISE(ABORT,
    '0006: session_input_subscriptions still reference timer/web_search signal_sources — refuse delete. Diagnose: SELECT sis.id, sis.session_id, sis.source_definition_id, ss.type FROM session_input_subscriptions sis JOIN signal_sources ss ON ss.id = sis.source_definition_id WHERE ss.type IN (''timer'',''web_search'');'
  )
  WHERE EXISTS (
    SELECT 1
    FROM `session_input_subscriptions` AS `sis`
    INNER JOIN `signal_sources` AS `ss` ON `ss`.`id` = `sis`.`source_definition_id`
    WHERE `ss`.`type` IN ('timer', 'web_search')
  );
END;--> statement-breakpoint
INSERT INTO `_assert_no_deprecated_source_refs` (`x`) VALUES (1);--> statement-breakpoint
DROP TRIGGER `_assert_no_deprecated_source_refs_trg`;--> statement-breakpoint
DROP TABLE `_assert_no_deprecated_source_refs`;--> statement-breakpoint

DELETE FROM `signal_sources` WHERE `type` IN ('timer', 'web_search');--> statement-breakpoint

-- Assert purge complete (CHECK fails if any leftover rows).
CREATE TEMP TABLE `_assert_deprecated_sources_gone` (
  `ok` INTEGER NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `_assert_deprecated_sources_gone` (`ok`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `signal_sources`
WHERE `type` IN ('timer', 'web_search');--> statement-breakpoint
DROP TABLE `_assert_deprecated_sources_gone`;
