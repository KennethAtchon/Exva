import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocList,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function StrategyOverviewPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Strategy</DocStrong> page configures how a single session
        researches, sizes, exits, and approves trades. It is the control surface
        between an <DocLink to="experiences">experience</DocLink> (which decides{" "}
        <em>what</em> a session can do) and the live runtime (which decides{" "}
        <em>how</em> each trade is placed). Everything here is one versioned
        strategy document per session — not separate per-table saves — and is
        snapshotted when the session starts so a running session always trades
        against the config it was launched with.
      </DocParagraph>

      <DocHeading id="sections" level={2}>
        The five sections
      </DocHeading>
      <DocParagraph>
        The page is split into five tabs for editing. They all live in the same
        document; saving writes a single patch with optimistic concurrency
        (version check). A conflict reloads the latest document instead of
        overwriting.
      </DocParagraph>
      <DocTable
        headers={["Tab", "Controls", "Detail"]}
        rows={[
          [
            "Style",
            "High-level research posture: processing mode, evidence bias, catalyst requirement, fundamental strictness.",
            <DocLink to="strategy-style">Style & research posture</DocLink>,
          ],
          [
            "Rules",
            "Hard trade mechanics: setup type, side bias, entry/exit style, scaling.",
            <DocLink to="strategy-rules">Trade rules</DocLink>,
          ],
          [
            "Risk",
            "Sizing, stops, loss/exposure caps, and approval. Drives the per-trade risk gates.",
            <DocLink to="risk">Risk & position sizing</DocLink>,
          ],
          [
            "Timeframe",
            "Primary bar size, holding style, and target/max hold window.",
            <DocLink to="timeframes">Timeframes & holding</DocLink>,
          ],
          [
            "AI",
            "Per-phase model, prompt, temperature, reasoning, and worker guidance.",
            <DocLink to="ai-phases">AI phase configuration</DocLink>,
          ],
        ]}
      />

      <DocHeading id="presets" level={2}>
        Global strategy presets
      </DocHeading>
      <DocParagraph>
        A <DocStrong>global strategy preset</DocStrong> is a saved full-document
        bundle from <DocInlineCode>config_presets</DocInlineCode> that applies
        Style, Rules, Risk, and Timeframe together in one step. Applying a
        preset writes immediately (with a version check). Each section can also
        be set to <DocInlineCode>custom</DocInlineCode>, which keeps your
        manually-tuned fields and tells the runtime not to assume any built-in
        tolerance profile.
      </DocParagraph>

      <DocHeading id="history" level={2}>
        Config history
      </DocHeading>
      <DocParagraph>
        Every successful save appends the previous document to history.{" "}
        <DocStrong>Config history</DocStrong> lists those versions, shows a
        section-level JSON diff against the current document, and can roll back
        to a prior version (again with a version check).
      </DocParagraph>

      <DocHeading id="lock" level={2}>
        Edit-lock behavior
      </DocHeading>
      <DocParagraph>
        Strategy config is locked while the session is running so runtime
        behavior cannot change mid-cycle. The page is editable only when the
        session is a draft or idle.
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Editable</DocStrong> — session status is{" "}
            <DocInlineCode>draft</DocInlineCode> or{" "}
            <DocInlineCode>idle</DocInlineCode>.
          </>,
          <>
            <DocStrong>Locked</DocStrong> — session status is{" "}
            <DocInlineCode>active</DocInlineCode>,{" "}
            <DocInlineCode>paused</DocInlineCode>, or{" "}
            <DocInlineCode>monitoring_only</DocInlineCode> (stopping when flat).
            To change strategy, stop the session, edit, then start again.
          </>,
        ]}
      />

      <DocHeading id="saving" level={2}>
        Saving & validation
      </DocHeading>
      <DocParagraph>
        Saving validates the full strategy context, then writes one document
        patch with the expected version. If another window already saved, you
        get a clear stale-version message and a reload — edits are not silently
        overwritten. A common validation failure is a posture that requires web
        evidence with no search provider configured — fix the provider on{" "}
        <DocLink to="accounts-brokers">Accounts</DocLink> or set a session
        override. The Rules section also compiles a trade-rules markdown block
        that is injected into the AI prompts, so rule changes reach the model on
        the next run.
      </DocParagraph>
      <DocCallout variant="tip" title="Where this goes">
        Style, Rules, and Timeframe shape what the AI is told to look for. Risk
        is enforced deterministically by the runtime regardless of what the
        model decides — see{" "}
        <DocLink to="risk" heading="gates">
          risk gates
        </DocLink>
        .
      </DocCallout>
    </>
  );
}
