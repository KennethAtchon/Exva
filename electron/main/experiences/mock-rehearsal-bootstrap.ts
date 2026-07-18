/**
 * Dev/test mock-rehearsal seam: ensure source + migrate sessions.
 * Composition root (app-services) owns this — not SignalService public API.
 *
 * Gate with EXVA_ENABLE_MOCK_REHEARSAL !== 'false' (default on so tests keep working).
 */
import type { SignalSourceRecord } from "@electron/shared/domain";
import { resolveMockRehearsalTicker } from "@electron/shared/instruments/mock-rehearsal";
import { env } from "../config/env";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";
import { ensureMockRehearsalSignalSource } from "./ensure-mock-rehearsal-signal-source";
import { migrateEligibleSessionsToMockRehearsal } from "./migrate-mock-rehearsal-subscriptions";
import { safeJsonParse } from "../services/infra/safe-json-parse";

export {
  buildMockRehearsalConfigJson,
  ensureMockRehearsalSignalSource,
  parseMockRehearsalConfigJson,
  syncMockRehearsalSignalSourceTicker,
  type MockRehearsalSignalConfig,
} from "./ensure-mock-rehearsal-signal-source";

export { migrateEligibleSessionsToMockRehearsal } from "./migrate-mock-rehearsal-subscriptions";

export function isMockRehearsalEnabled(): boolean {
  return env.enableMockRehearsal;
}

type MockRehearsalRegistry = {
  get(sourceId: string):
    | {
        restart(config: Record<string, unknown>): void | Promise<void>;
      }
    | null
    | undefined;
  create(source: SignalSourceRecord): void;
  start(sourceId: string): void | Promise<void>;
};

function attachSourceToRegistry(
  registry: MockRehearsalRegistry,
  source: SignalSourceRecord,
): void {
  if (!registry.get(source.id)) {
    registry.create(source);
    if (source.enabled) {
      void registry.start(source.id);
    }
    return;
  }
  const runtime = registry.get(source.id);
  if (runtime) {
    const config =
      safeJsonParse<Record<string, unknown>>(
        source.configJson,
        undefined,
        "mock-rehearsal-bootstrap.config",
      ) ?? {};
    void runtime.restart(config);
  }
}

/** Ensure mock-rehearsal source exists and is attached to the runtime registry. */
export function bootstrapMockRehearsalSignalSource(
  sourcesRepo: SignalSourcesRepo,
  registry: MockRehearsalRegistry,
  ticker: string = resolveMockRehearsalTicker(),
): SignalSourceRecord {
  const source = ensureMockRehearsalSignalSource(sourcesRepo, ticker);
  attachSourceToRegistry(registry, source);
  return source;
}

export function bootstrapMockRehearsal(deps: {
  sourcesRepo: SignalSourcesRepo;
  registry: MockRehearsalRegistry;
  sessions: Array<{ id: string; experienceId: string }>;
  listAssignments: (sessionId: string) => Array<{ brokerAccountId: string }>;
  brokerAccounts: Array<{
    id: string;
    brokerType: string;
    mockScenarioKind?:
      | import("@electron/shared/domain/mock-scenario").MockScenarioKind
      | null;
  }>;
}): string[] {
  if (!isMockRehearsalEnabled()) return [];

  bootstrapMockRehearsalSignalSource(deps.sourcesRepo, deps.registry);
  // V2: session subscriptions are managed via session_input_subscriptions.
  // migrateEligibleSessionsToMockRehearsal is a no-op stub that always returns [].
  void deps;
  return migrateEligibleSessionsToMockRehearsal();
}
