import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/catalog/session-instrument-classes";
import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";
import { fetchPredictionMarketCandidates } from "./prediction-market-candidates";

export async function buildSelectionInstructions(ctx: OrchestratorContext, session: WorkspaceSession): Promise<string> {
  const instrumentClasses = ctx.getEffectiveInstrumentClasses(session);
  const brokerCoverage = renderBrokerCoverageInstructions(ctx, session, instrumentClasses);

  if (isSearchEverythingScope(session)) {
    const sections = [
      [
        "Selector mode: full-universe discovery.",
        `Search across the full tradable universe for these broker-backed classes: ${instrumentClasses.join(", ")}.`,
        "Start broad, enumerate all serious candidate instruments you discover, and then research each candidate online before you rank it.",
        "Use live discovery/search evidence for every candidate you keep. Do not rely on memory-only ticker recall.",
        "Verify tradability with the market tools before submitting a candidate. Exclude anything that has no broker coverage or cannot be verified.",
        "Return ranked candidates through the selector pipeline output. Strongest setups first, up to the configured maximum.",
      ].join("\n"),
      brokerCoverage,
    ];

    const predictionCandidates = await renderPredictionMarketCandidatesInstructions(ctx, instrumentClasses);
    if (predictionCandidates) sections.push(predictionCandidates);

    return sections.filter(Boolean).join("\n\n");
  }

  const sections = [session.instrumentScope, brokerCoverage];
  const predictionCandidates = await renderPredictionMarketCandidatesInstructions(ctx, instrumentClasses);
  if (predictionCandidates) sections.push(predictionCandidates);
  return sections.filter(Boolean).join("\n\n");
}

function isSearchEverythingScope(session: WorkspaceSession): boolean {
  return session.instrumentScope.trim() === SEARCH_EVERYTHING_SCOPE;
}

function renderBrokerCoverageInstructions(
  ctx: OrchestratorContext,
  session: WorkspaceSession,
  instrumentClasses: InstrumentClass[],
): string {
  const assignedBrokerIds = ctx.deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(session.id);
  const assignedBrokers = assignedBrokerIds
    .map((brokerAccountId) => ctx.deps.brokerAccountsRepo.find(brokerAccountId))
    .filter((broker): broker is NonNullable<typeof broker> => Boolean(broker));

  const lines = ["Broker coverage constraints:"];

  if (assignedBrokers.length === 0) {
    lines.push("- No broker accounts are assigned to this session. Do not assume any instrument is tradable.");
    return lines.join("\n");
  }

  lines.push("- Assigned brokers:");
  for (const broker of assignedBrokers) {
    lines.push(`  - ${broker.name} (${broker.id}) supports: ${broker.supportedInstrumentClasses.join(", ")}`);
  }

  lines.push("- Enabled class coverage:");
  for (const instrumentClass of instrumentClasses) {
    const coveringBrokers = assignedBrokers.filter((broker) => broker.supportedInstrumentClasses.includes(instrumentClass));
    if (coveringBrokers.length === 0) {
      lines.push(`  - ${instrumentClass}: NO broker coverage. Do not return candidates for this class.`);
      continue;
    }
    lines.push(
      `  - ${instrumentClass}: tradable via ${coveringBrokers.map((broker) => `${broker.name} (${broker.id})`).join(", ")}`,
    );
  }

  lines.push("- If get_quote/get_news/get_ohlcv cannot verify an instrument, treat it as not tradable enough for this session and exclude it.");
  return lines.join("\n");
}

async function renderPredictionMarketCandidatesInstructions(
  ctx: OrchestratorContext,
  instrumentClasses: InstrumentClass[],
): Promise<string | null> {
  if (!instrumentClasses.includes("prediction_market")) {
    return null;
  }

  const candidates = await fetchPredictionMarketCandidates(ctx);
  if (candidates.length === 0) {
    return null;
  }

  return `Prediction-market candidates (return only these canonical rows for prediction_market):\n${candidates
    .map((candidate) => `- ${JSON.stringify(candidate)}`)
    .join("\n")}`;
}
