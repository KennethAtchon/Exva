import type { WorkspaceSession } from "@/lib/types";
import { resolveEffectiveInstrumentClasses } from "@electron/shared/instruments/session-instrument-classes";
import type { OrchestratorDeps } from "./session-types";

export function resolveSessionInstrumentClasses(
  session: WorkspaceSession,
  deps: Pick<
    OrchestratorDeps,
    | "sessionSelectorSettingsRepo"
    | "sessionBrokerAssignmentsRepo"
    | "brokerAccountsRepo"
  >,
) {
  const selectorSettings = deps.sessionSelectorSettingsRepo.get(session.id);
  const assignedBrokers = deps.sessionBrokerAssignmentsRepo
    .listBrokerAccountIds(session.id)
    .map((brokerAccountId) => deps.brokerAccountsRepo.find(brokerAccountId))
    .filter((broker): broker is NonNullable<typeof broker> => Boolean(broker));

  return resolveEffectiveInstrumentClasses(
    {
      instrumentClasses: session.instrumentClasses,
      instrumentScope: session.instrumentScope,
      selectorSettings,
    },
    assignedBrokers,
  );
}
