import { DocParagraph, DocTable } from "../primitives";

export function AppPagesPage() {
  return (
    <>
      <DocParagraph>
        Reference map of every major page in the Exva desktop app and its role
        in the operator workflow.
      </DocParagraph>
      <DocTable
        headers={["Page", "Category", "Purpose"]}
        rows={[
          ["Dashboard", "Primary", "Live stats, open trades, agent feed."],
          ["Sessions", "Primary", "Create, configure, and monitor sessions."],
          ["Trades", "Primary", "Trade history, filters, and summaries."],
          ["Strategy", "Primary", "Risk limits, sizing, AI phase config."],
          ["Autopsy", "Analysis", "Period and trade-level post-mortems."],
          [
            "Leaderboard",
            "Analysis",
            "Experience scorecards and promotion tiers.",
          ],
          [
            "API Usage",
            "Analysis",
            "Model spend, projections, cost attribution.",
          ],
          ["Brokers", "Setup", "Broker accounts, health, capital allocation."],
          ["Signals", "Setup", "Global signal source configuration."],
          [
            "Accounts",
            "Setup",
            "AI keys, search providers, environment toggle.",
          ],
          ["Docs", "Setup", "This documentation."],
          ["Developer", "Setup", "Event log and agent run traces."],
        ]}
      />
    </>
  );
}
