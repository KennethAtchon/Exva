import {
  DocCallout,
  DocHeading,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function DashboardDocPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Dashboard</DocStrong> is the live operating view: current
        stats, open trades, the agent activity feed, and the approval queue.
        What it shows depends on <DocLink to="environment">scope</DocLink> — one
        focused session, or an aggregate of non-archived sessions in the current
        environment.
      </DocParagraph>

      <DocHeading id="scope" level={2}>
        Scope
      </DocHeading>
      <DocParagraph>
        In <DocStrong>focused</DocStrong> mode the dashboard reflects a single
        session. In <DocStrong>global</DocStrong> mode it aggregates
        non-archived sessions in the current environment by default. Paper and
        live environments are always kept separate.
      </DocParagraph>

      <DocHeading id="metrics" level={2}>
        Header metrics
      </DocHeading>
      <DocTable
        headers={["Metric", "Definition"]}
        rows={[
          [
            "Portfolio value",
            "Real broker-backed value when available; a dash when Exva can't confirm it (it never guesses).",
          ],
          ["Daily P&L", "Profit and loss for today within the current scope."],
          [
            "Win rate",
            "Share of closed trades in scope that finished positive.",
          ],
          [
            "AI cost",
            "Model spend attributed to the scope, against the daily budget where available.",
          ],
        ]}
      />

      <DocHeading id="approvals" level={2}>
        Approval queue
      </DocHeading>
      <DocParagraph>
        When a session has{" "}
        <DocLink to="risk" heading="stops">
          human approval
        </DocLink>{" "}
        enabled, sized and gated proposals wait here for an approve or reject
        decision before execution. The queue is the human-in-the-loop checkpoint
        between the AI decision and a real order.
      </DocParagraph>

      <DocCallout variant="info" title="Agent feed">
        The activity feed streams what each pipeline phase is doing in real
        time; deeper run traces live on the{" "}
        <DocLink to="app-pages">Settings → Developer</DocLink> tab.
      </DocCallout>
    </>
  );
}
