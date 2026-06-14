import {
  DocHeading,
  DocLink,
  DocList,
  DocParagraph,
  DocTable,
} from "../primitives";

export function SessionsDocPage() {
  return (
    <>
      <DocHeading id="session-statuses" level={2}>
        Session statuses
      </DocHeading>
      <DocTable
        headers={["Status", "Behavior"]}
        rows={[
          ["Draft", "Created but never started."],
          ["Active", "Processing signals and managing open positions."],
          [
            "Paused",
            "No new research cycles; existing positions still monitored.",
          ],
          [
            "Stopping when flat",
            "No new entries; exits complete then session stops.",
          ],
          [
            "Needs attention",
            "Runtime error or blocking condition requires operator action.",
          ],
          ["Idle", "Stopped cleanly; ready to start again."],
          ["Stopped", "Fully halted; open positions may lack automated exits."],
          [
            "Archived",
            "Hidden from active workflows; available for historical review.",
          ],
        ]}
      />

      <DocHeading id="header-controls" level={2}>
        Header controls
      </DocHeading>
      <DocList
        items={[
          <>
            <strong>Start / Resume</strong> — Begins or resumes signal
            processing. Live sessions trigger{" "}
            <DocLink to="environment">readiness checks</DocLink> first.
          </>,
          <>
            <strong>Pause</strong> — Stops dequeuing new signals; queued
            deliveries expire after 4 hours while paused.
          </>,
          <>
            <strong>Stop when flat</strong> — Stops new entries immediately;
            waits for open trades to close.
          </>,
          <>
            <strong>Force stop</strong> — Ends automated exit management. Use
            only when you accept unmanaged open positions.
          </>,
        ]}
      />

      <DocHeading id="delivery-statuses" level={2}>
        Signal delivery statuses
      </DocHeading>
      <DocParagraph>
        These appear in the session detail drawer for each{" "}
        <DocLink to="signal-architecture">signal delivery</DocLink>:
      </DocParagraph>
      <DocTable
        headers={["Status", "Meaning"]}
        rows={[
          ["Queued", "Waiting its turn for this session."],
          ["Waiting for resume", "Queued while session was paused."],
          ["Evaluating", "Pipeline is actively running for this signal."],
          ["Triggered cycle", "Research started; no trade confirmed yet."],
          ["Trade opened", "Signal led to an executed trade."],
          ["Rejected", "Pipeline reviewed but decided not to trade."],
          ["Dropped", "Discarded due to routing or compatibility issue."],
          ["Expired", "Sat too long while paused; no longer valid."],
        ]}
      />
    </>
  );
}
