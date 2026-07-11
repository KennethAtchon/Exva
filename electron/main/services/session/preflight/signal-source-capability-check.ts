import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Warns when signal sources subscribed to this session emit instrument classes
 * that no assigned broker can execute. These signals will always dead-letter,
 * so the operator should either remove the source or add a compatible broker.
 *
 * This check is warn-only (returns ok:true) to avoid blocking existing sessions.
 * The incompatible pairs are logged so they show up in startup logs.
 */
export async function signalSourceCapabilityCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  const sourceIds = deps.signalSourcesRepo.subscribedSourceIdsForSession(
    session.id,
  );
  if (sourceIds.length === 0) return { ok: true };

  const assignmentIds = deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(
    session.id,
  );
  const brokerAccounts = assignmentIds.map((id) =>
    deps.brokerAccountsRepo.find(id),
  );

  const incompatible: Array<{
    sourceId: string;
    sourceName: string;
    instrumentClass: string;
  }> = [];

  for (const sourceId of sourceIds) {
    const source = deps.signalSourcesRepo.get(sourceId);
    if (!source?.instrumentClass) continue;

    const hasCompatibleBroker = brokerAccounts.some(
      (account) =>
        account?.supportedInstrumentClasses.includes(
          source.instrumentClass as InstrumentClass,
        ) ?? false,
    );

    if (!hasCompatibleBroker) {
      incompatible.push({
        sourceId,
        sourceName: source.name,
        instrumentClass: source.instrumentClass,
      });
    }
  }

  if (incompatible.length > 0) {
    deps.logger.warn(
      { sessionId: session.id, incompatibleSources: incompatible },
      `Session has ${incompatible.length} signal source(s) whose instrument class is not supported by any assigned broker. ` +
        `These will always dead-letter: ${incompatible.map((s) => `${s.sourceName} (${s.instrumentClass})`).join(", ")}`,
    );
  }

  return { ok: true };
}
