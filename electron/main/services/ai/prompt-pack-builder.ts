import type { AgentRole, SessionRiskConfig } from "@/lib/types";
import type { SessionStrategyContext, StrategySnapshot } from "@electron/shared/domain";
import { buildStrategyPromptContext } from "./strategy-prompt-context";
import type { RoleToolPolicy, RuntimeAgentMessage } from "./ai-runtime/ai-runtime-types";
import { ROLE_TOOL_POLICY } from "./ai-runtime/ai-runtime-types";
import type { HarnessToolAvailability } from "./ai-runtime/harness-tools";
import type { SessionStrategyContextService } from "../session/session-strategy-context-service";
import INSTRUCTIONS from "./prompt-instructions.json";

export interface AgentTaskPrompt {
  instrumentSymbol?: string;
  instrumentDisplayName?: string | null;
  bodyMarkdown: string;
  cycleId?: string | null;
  tradeId?: string | null;
}

export interface RuntimeRiskPolicy {
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  waitForOpenThreshold: number;
  maxAiSpendUsd: number;
  maxDataSpendUsd: number;
  humanApprovalRequired: boolean;
}

export interface MarketContextPack {
  markdown: string;
  snapshotJson: string | null;
}

export interface PromptPack {
  messages: RuntimeAgentMessage[];
  strategySnapshot: StrategySnapshot;
  marketSnapshotJson: string | null;
  toolPolicy: RoleToolPolicy;
  /** Same predicates used to register tools for this run (policy ∩ infra). */
  harnessToolAvailability: HarnessToolAvailability;
  riskPolicy: RuntimeRiskPolicy;
}

// ── Primitives ───────────────────────────────────────────────────────────────

type Part = string | false | null | undefined;

/** Join non-falsy parts with a single newline. */
function lines(...parts: Part[]): string {
  return (parts.filter(Boolean) as string[]).join("\n");
}

/** Join non-falsy parts separated by a blank line. */
function sections(...parts: Part[]): string {
  return (parts.filter(Boolean) as string[]).join("\n\n");
}

function xmlBlock(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

// ── Public class ─────────────────────────────────────────────────────────────

export class AgentPromptPackBuilder {
  constructor(private readonly strategyContextService: SessionStrategyContextService) {}

  build(input: {
    sessionId: string;
    role: AgentRole;
    basePromptMarkdown: string;
    task: AgentTaskPrompt;
    harnessToolAvailability: HarnessToolAvailability;
    sandboxMode?: boolean;
  }): PromptPack {
    const strategy = this.strategyContextService.get(input.sessionId);
    const strategyPrompt = renderStrategyContextMarkdown(strategy, input.role);
    const toolPolicy = ROLE_TOOL_POLICY[input.role];
    const riskPolicy = buildRuntimeRiskPolicy(strategy.riskConfig);
    const market = buildMarketContextPlaceholder(input.role);

    return {
      messages: [
        { role: "system", content: renderSystemPrompt({ role: input.role, basePromptMarkdown: input.basePromptMarkdown, toolPolicy, sandboxMode: input.sandboxMode }) },
        { role: "user", content: renderUserMessage({ strategyPrompt: strategyPrompt.prompt, market, riskPolicy, harnessToolAvailability: input.harnessToolAvailability, toolPolicy, task: input.task }) },
      ],
      strategySnapshot: strategyPrompt.snapshot,
      marketSnapshotJson: market.snapshotJson,
      toolPolicy,
      harnessToolAvailability: input.harnessToolAvailability,
      riskPolicy,
    };
  }
}

// ── Exported functions ────────────────────────────────────────────────────────

export function buildRuntimeRiskPolicy(riskConfig: SessionRiskConfig): RuntimeRiskPolicy {
  return {
    maxPositionUsd: riskConfig.maxPositionUsd,
    maxExposureUsd: riskConfig.maxExposureUsd,
    waitForOpenThreshold: riskConfig.waitForOpenThreshold,
    maxAiSpendUsd: riskConfig.maxAiSpendUsd,
    maxDataSpendUsd: riskConfig.maxDataSpendUsd,
    humanApprovalRequired: riskConfig.humanApprovalRequired,
  };
}

export function renderStrategyContextMarkdown(context: SessionStrategyContext, role: AgentRole) {
  const built = buildStrategyPromptContext(context);
  return {
    snapshot: built.snapshot,
    prompt: sections(
      built.prompt,
      `## Runtime interpretation\n${lines(...INSTRUCTIONS.runtimeInterpretation, `- Current role receiving this context: ${role}.`)}`,
    ),
  };
}

// ── Private render functions ──────────────────────────────────────────────────

function renderSystemPrompt(input: {
  role: AgentRole;
  basePromptMarkdown: string;
  toolPolicy: RoleToolPolicy;
  sandboxMode?: boolean;
}): string {
  return sections(
    input.basePromptMarkdown.trim(),
    `## Runtime Authority\n${input.sandboxMode ? INSTRUCTIONS.runtimeAuthority.sandbox : INSTRUCTIONS.runtimeAuthority.live}`,
    input.sandboxMode && `## Sandbox Mode\n${lines(...INSTRUCTIONS.sandboxBlock)}`,
    `## Tool Policy For This Role\n${renderToolPolicyStructural(input.role, input.toolPolicy)}`,
    `## Safety Rules\n${lines(...INSTRUCTIONS.safetyRules)}`,
  );
}

function renderUserMessage(input: {
  strategyPrompt: string;
  market: MarketContextPack;
  riskPolicy: RuntimeRiskPolicy;
  harnessToolAvailability: HarnessToolAvailability;
  toolPolicy: RoleToolPolicy;
  task: AgentTaskPrompt;
}): string {
  return sections(
    xmlBlock("trusted_session_context", sections(
      input.strategyPrompt,
      `## Risk controls\n${renderRiskControls(input.riskPolicy)}`,
    )),
    xmlBlock("trusted_market_context", input.market.markdown),
    !input.toolPolicy.enforceNoTools && xmlBlock("tool_availability", buildToolAvailabilityContent(input.harnessToolAvailability, input.toolPolicy)),
    input.toolPolicy.allowSubmitCandidates && xmlBlock("selector_output_contract", lines(...INSTRUCTIONS.selectorOutputContract)),
    xmlBlock("task", input.task.bodyMarkdown.trim()),
  );
}

function renderRiskControls(p: RuntimeRiskPolicy): string {
  return lines(
    `- Max position USD: ${p.maxPositionUsd}`,
    `- Max exposure USD: ${p.maxExposureUsd ?? "not configured"}`,
    `- Wait-for-open confidence threshold: ${p.waitForOpenThreshold}`,
    `- Max AI spend USD: ${p.maxAiSpendUsd}`,
    `- Max data spend USD: ${p.maxDataSpendUsd}`,
    `- Human approval required: ${p.humanApprovalRequired ? "yes" : "no"}`,
  );
}

function renderToolPolicyStructural(role: AgentRole, policy: RoleToolPolicy): string {
  if (policy.enforceNoTools) {
    return INSTRUCTIONS.toolPolicy.noToolsTemplate.replace("{role}", role);
  }

  const tp = INSTRUCTIONS.toolPolicy;
  const isSelector = role === "instrument_selector";
  return lines(
    tp.preamble,
    policy.allowSearch          && tp.searchWeb,
    policy.allowFetchUrl        && tp.fetchUrl,
    policy.allowSearchReddit    && tp.searchReddit,
    policy.allowTrendingSymbols && tp.trendingSymbols,
    isSelector && policy.allowMarketQuoteTools && tp.getQuote,
    isSelector && policy.allowMarketQuoteTools && tp.getOhlcv,
    isSelector && policy.allowMarketNewsTool   && tp.getNewsSelector,
    isSelector                                 && lines(...tp.submitCandidatesRules),
    !isSelector && policy.allowMarketNewsTool  && tp.getNewsAnalyst,
    !isSelector                                && tp.noQuoteOhlcv,
    tp.untrustedWarning,
  );
}

function buildToolAvailabilityContent(avail: HarnessToolAvailability, policy: RoleToolPolicy): string {
  const r = INSTRUCTIONS.toolAvailability.unavailableReasons;
  const anyAvailable = avail.searchWeb || avail.fetchUrl || avail.searchReddit || avail.trendingSymbols ||
    avail.getNews || avail.getQuote || avail.getOhlcv || avail.submitCandidates;

  return lines(
    policy.allowSearch           && `search_web: ${avail.searchWeb ? "YES" : r.searchWeb}`,
    policy.allowFetchUrl         && `fetch_url: ${avail.fetchUrl ? "YES" : r.fetchUrl}`,
    policy.allowSearchReddit     && `search_reddit: ${avail.searchReddit ? "YES" : r.searchReddit}`,
    policy.allowTrendingSymbols  && `get_trending_symbols: ${avail.trendingSymbols ? "YES" : r.trendingSymbols}`,
    policy.allowMarketQuoteTools && `get_quote: ${avail.getQuote ? "YES" : r.getQuote}`,
    policy.allowMarketQuoteTools && `get_ohlcv: ${avail.getOhlcv ? "YES" : r.getOhlcv}`,
    policy.allowMarketNewsTool   && `get_news: ${avail.getNews ? "YES" : r.getNews}`,
    policy.allowSubmitCandidates && `submit_candidates: ${avail.submitCandidates ? "YES" : r.submitCandidates}`,
    !anyAvailable                && INSTRUCTIONS.toolAvailability.noToolsNote,
  );
}

function buildMarketContextPlaceholder(role: AgentRole): MarketContextPack {
  const analystRoles: AgentRole[] = ["analyst_technical", "analyst_fundamental"];
  if (!analystRoles.includes(role)) {
    return { markdown: INSTRUCTIONS.marketContext.notRequired, snapshotJson: null };
  }
  return { markdown: lines(...INSTRUCTIONS.marketContext.unavailable), snapshotJson: null };
}
