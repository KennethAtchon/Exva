import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function AiPhasesConfigPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>AI</DocStrong> section configures the model behind each
        research phase. For the conceptual flow — what each phase does and how
        they chain — see <DocLink to="pipeline">Pipeline & AI phases</DocLink>.
        This page covers the per-phase <em>configuration</em> exposed on the
        Strategy tab.
      </DocParagraph>

      <DocHeading id="phases" level={2}>
        Configurable phases
      </DocHeading>
      <DocParagraph>
        Five phases can be tuned independently:{" "}
        <DocInlineCode>selector</DocInlineCode>,{" "}
        <DocInlineCode>technical</DocInlineCode>,{" "}
        <DocInlineCode>fundamental</DocInlineCode>,{" "}
        <DocInlineCode>review</DocInlineCode>, and{" "}
        <DocInlineCode>decision</DocInlineCode>. Each carries its own model and
        prompt, so you can run a cheap model for the selector and a strong model
        for the decision phase in the same session.
      </DocParagraph>

      <DocHeading id="fields" level={2}>
        Per-phase fields
      </DocHeading>
      <DocTable
        headers={["Field", "Role"]}
        rows={[
          [
            <DocInlineCode>providerKey / modelId</DocInlineCode>,
            "Which provider and model run the phase. Falls back to the workspace default model when unset.",
          ],
          [
            <DocInlineCode>temperature</DocInlineCode>,
            "Sampling temperature for the phase.",
          ],
          [
            <DocInlineCode>maxTokens</DocInlineCode>,
            "Output token ceiling for the phase response.",
          ],
          [
            <DocInlineCode>reasoningLevel</DocInlineCode>,
            "off · auto · low · medium · high · max — how much extended reasoning the model is allowed.",
          ],
          [
            <DocInlineCode>promptSource</DocInlineCode>,
            "default uses the built-in phase prompt; session_override uses your custom prompt markdown.",
          ],
          [
            <DocInlineCode>promptMarkdown</DocInlineCode>,
            "The override prompt body, used only when promptSource is session_override.",
          ],
        ]}
      />

      <DocHeading id="guidance" level={2}>
        Worker guidance
      </DocHeading>
      <DocParagraph>
        Separate from per-phase prompts, the AI section holds{" "}
        <DocStrong>worker guidance</DocStrong> — a markdown block injected into{" "}
        <em>every</em> phase. Use it for hard, cross-cutting instructions that
        should apply no matter which phase is running.{" "}
        <DocLink to="strategy-style" heading="notes">
          Posture notes
        </DocLink>{" "}
        color style; worker guidance is verbatim hard guidance.
      </DocParagraph>

      <DocHeading id="tools" level={2}>
        Worker tools
      </DocHeading>
      <DocParagraph>
        Phase workers have access to tools including web search, URL fetch (for
        filings), market quotes, OHLCV history, and structured result
        submission. Web-evidence postures require a search provider to be
        configured on <DocLink to="accounts-brokers">Accounts</DocLink> or
        overridden on the session.
      </DocParagraph>

      <DocCallout variant="info" title="Spend is tracked per phase">
        AI cost is attributed by phase against the session and daily caps from
        the <DocLink to="risk">Risk</DocLink> tab. The{" "}
        <DocLink to="cost-tracking">AI cost</DocLink> page breaks spend down by
        phase so you can see where budget goes.
      </DocCallout>
    </>
  );
}
