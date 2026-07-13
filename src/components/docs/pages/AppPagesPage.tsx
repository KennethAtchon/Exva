import { DocParagraph, DocTable } from "../primitives";

export function AppPagesPage() {
  return (
    <>
      <DocParagraph>
        Exva’s operator UI is five hubs plus Docs. Trade detail and trade
        autopsy remain drill-in overlays. ⌘K opens the command palette (actions
        + search); the assistant is available from the palette or its own
        control.
      </DocParagraph>
      <DocTable
        headers={["Hub", "Absorbs", "Purpose"]}
        rows={[
          [
            "Dashboard",
            "Live pulse + attention",
            "Equity curve, morning briefing, kill-switch panel, P&L, approvals, promotion ladder, agent feed.",
          ],
          [
            "Sessions",
            "Sessions / Trades / Config",
            "Runtime controls, trade history, strategy document for the focused session.",
          ],
          [
            "Signals & Schedules",
            "Feeds / Events / Instrument sets / Data Doctor",
            "Two-pane feeds vs schedules, instrument sets, coverage matrix and backfill.",
          ],
          [
            "Research",
            "Leaderboard / Autopsies / Costs / Lab / Attribution",
            "Scorecards, merged period autopsies, API spend, Backtest Lab, equity net of AI.",
          ],
          [
            "Settings",
            "Accounts / Brokers / Developer",
            "Credentials, paper balances, notification sinks, backups; Dev workbench when developing.",
          ],
          ["Docs", "Standalone", "This documentation and glossary."],
        ]}
      />
    </>
  );
}
