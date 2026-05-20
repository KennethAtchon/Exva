import type { InstrumentClass } from "@/lib/types";
import type { InputBuilder, InputBuilderContext } from "../registry/input-builder-registry";

export const brokerCoverageInputBuilder: InputBuilder = {
  id: "broker-coverage",
  build(ctx) {
    return Promise.resolve(renderBrokerCoverageInstructions(ctx, ctx.instrumentClasses));
  },
};

function renderBrokerCoverageInstructions(
  ctx: InputBuilderContext,
  instrumentClasses: InstrumentClass[],
): string {
  const assignedBrokerIds = ctx.services.sessionBrokerAssignmentsRepo.listBrokerAccountIds(ctx.session.id);
  const assignedBrokers = assignedBrokerIds
    .map((brokerAccountId) => ctx.services.brokerAccountsRepo.find(brokerAccountId))
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
