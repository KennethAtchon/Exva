/**
 * Single entry for mock-rehearsal ensure/migrate helpers.
 * SignalService (and composition root) can import from here instead of
 * reaching into individual experience modules.
 */
export {
  buildMockRehearsalConfigJson,
  ensureMockRehearsalSignalSource,
  parseMockRehearsalConfigJson,
  syncMockRehearsalSignalSourceTicker,
  type MockRehearsalSignalConfig,
} from "./ensure-mock-rehearsal-signal-source";

export { migrateEligibleSessionsToMockRehearsal } from "./migrate-mock-rehearsal-subscriptions";
