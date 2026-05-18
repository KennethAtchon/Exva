import type { PrepareStepFunction, StepResult, ToolSet } from "ai";
import { normalizeQueryFamily, validateDiscoveryQuery } from "../search/sanitize-search-query";
import type { HarnessToolAvailability } from "../pipeline-runtime/context/tool-factory-registry";

type StepLike = {
  toolCalls: Array<{
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
  }>;
  toolResults?: Array<{
    toolCallId?: string;
    output?: unknown;
  }>;
};

type SelectorToolEvent = {
  tool: string;
  input: unknown;
  output: unknown;
};

type SelectorPhase = "discovery" | "verification" | "commit" | "force_commit";

const DISCOVERY_TOOLS = ["search_web", "search_reddit", "get_trending_symbols", "fetch_url"] as const;
const VERIFICATION_TOOLS = ["get_quote", "get_news", "get_ohlcv", "fetch_url"] as const;
const COMMIT_TOOLS = ["submit_candidates", "get_quote", "get_news", "get_ohlcv", "fetch_url"] as const;
const SEARCH_TOOLS = new Set<string>(["search_web", "search_reddit"]);
const VERIFICATION_SYMBOL_TOOLS = new Set<string>(["get_quote", "get_news", "get_ohlcv"]);
const COMMON_SYMBOL_TOKENS = new Set([
  "A",
  "AI",
  "API",
  "ETF",
  "FOR",
  "HTTP",
  "JSON",
  "NEWS",
  "NOW",
  "PDF",
  "THE",
  "TOP",
  "USD",
  "URL",
  "WEB",
]);

const DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS = 8;
const DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS = 6;
const DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS = 2;
const DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS = 2;
const DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION = 3;
const DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP = 14;

export interface SelectorRuntimeSettings {
  maxDiscoverySteps: number;
  maxVerificationSteps: number;
  maxNoNewInfoSteps: number;
  maxRepeatedSymbolChecks: number;
  minCandidatesBeforeVerification: number;
  forceSubmitAfterStep: number;
}

export function defaultSelectorRuntimeSettings(): SelectorRuntimeSettings {
  return {
    maxDiscoverySteps: DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS,
    maxVerificationSteps: DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS,
    maxNoNewInfoSteps: DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS,
    maxRepeatedSymbolChecks: DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS,
    minCandidatesBeforeVerification: DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION,
    forceSubmitAfterStep: DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP,
  };
}

export interface SelectorStepAnalysis {
  queryCount: number;
  duplicateQueryCount: number;
  invalidQueryCount: number;
  uniqueSymbols: string[];
  uniqueDomains: string[];
  repeatedSymbolChecks: number;
  maxRepeatedSymbolChecks: number;
  noNewInfoStreak: number;
  sawSubmitCandidates: boolean;
}

export function buildSelectorPrepareStep(
  availability: HarnessToolAvailability,
  settings: SelectorRuntimeSettings,
): PrepareStepFunction<ToolSet> {
  return ({ stepNumber, steps }) => {
    if (stepNumber === 0 && availability.searchWeb) {
      return {
        activeTools: ["search_web"],
        toolChoice: { type: "tool", toolName: "search_web" },
      };
    }

    const phase = determineSelectorPhase(steps, stepNumber, settings);
    const activeTools = activeToolsForPhase(phase, availability);
    if (activeTools.length === 0) return {};

    if (phase === "force_commit" && activeTools.includes("submit_candidates")) {
      return {
        activeTools,
        toolChoice: { type: "tool", toolName: "submit_candidates" },
      };
    }

    return { activeTools };
  };
}

export function analyzeSelectorSteps(steps: StepLike[]): SelectorStepAnalysis {
  const seenQueryFamilies = new Set<string>();
  const seenSymbols = new Set<string>();
  const seenDomains = new Set<string>();
  const verifyCounts = new Map<string, number>();

  let queryCount = 0;
  let duplicateQueryCount = 0;
  let invalidQueryCount = 0;
  let repeatedSymbolChecks = 0;
  let maxRepeatedSymbolChecks = 0;
  let noNewInfoStreak = 0;
  let sawSubmitCandidates = false;

  for (const step of steps) {
    const events = selectorEventsFromStep(step);
    if (events.length === 0) continue;

    let stepAddedNewInfo = false;

    for (const event of events) {
      if (event.tool === "submit_candidates") {
        sawSubmitCandidates = true;
      }

      if (SEARCH_TOOLS.has(event.tool)) {
        const query = readStringField(event.input, "query");
        if (query) {
          queryCount += 1;
          const validation = validateDiscoveryQuery(query);
          if (!validation.ok) {
            invalidQueryCount += 1;
          }
          if (validation.normalizedFamily) {
            if (seenQueryFamilies.has(validation.normalizedFamily)) {
              duplicateQueryCount += 1;
            } else {
              seenQueryFamilies.add(validation.normalizedFamily);
              stepAddedNewInfo = true;
            }
          }
        }
      }

      for (const symbol of extractSymbolsFromEvent(event)) {
        if (!seenSymbols.has(symbol)) {
          seenSymbols.add(symbol);
          stepAddedNewInfo = true;
        }
      }

      for (const domain of extractDomainsFromEvent(event)) {
        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          stepAddedNewInfo = true;
        }
      }

      if (VERIFICATION_SYMBOL_TOOLS.has(event.tool)) {
        const symbol = normalizeSymbol(readStringField(event.input, "symbol"));
        if (symbol) {
          const nextCount = (verifyCounts.get(symbol) ?? 0) + 1;
          verifyCounts.set(symbol, nextCount);
          if (nextCount > 1) {
            repeatedSymbolChecks += 1;
            maxRepeatedSymbolChecks = Math.max(maxRepeatedSymbolChecks, nextCount - 1);
          }
        }
      }
    }

    noNewInfoStreak = stepAddedNewInfo ? 0 : noNewInfoStreak + 1;
  }

  return {
    queryCount,
    duplicateQueryCount,
    invalidQueryCount,
    uniqueSymbols: [...seenSymbols],
    uniqueDomains: [...seenDomains],
    repeatedSymbolChecks,
    maxRepeatedSymbolChecks,
    noNewInfoStreak,
    sawSubmitCandidates,
  };
}

function determineSelectorPhase(
  steps: StepLike[],
  stepNumber: number,
  settings: SelectorRuntimeSettings,
): SelectorPhase {
  const analysis = analyzeSelectorSteps(steps);
  const discoveryBudgetHit = stepNumber >= settings.maxDiscoverySteps;
  const verificationBudgetHit = stepNumber >= settings.maxDiscoverySteps + settings.maxVerificationSteps;
  const enoughCandidates = analysis.uniqueSymbols.length >= settings.minCandidatesBeforeVerification;
  const noNewInfo = analysis.noNewInfoStreak >= settings.maxNoNewInfoSteps;
  const repeatedChecks = analysis.maxRepeatedSymbolChecks >= settings.maxRepeatedSymbolChecks;

  if (stepNumber >= settings.forceSubmitAfterStep) {
    return "force_commit";
  }

  if (verificationBudgetHit) {
    return "commit";
  }

  if (discoveryBudgetHit || enoughCandidates || noNewInfo || repeatedChecks) {
    return "verification";
  }

  return "discovery";
}

function activeToolsForPhase(phase: SelectorPhase, availability: HarnessToolAvailability): Array<keyof ToolSet> {
  const source = phase === "discovery"
    ? DISCOVERY_TOOLS
    : phase === "verification"
      ? VERIFICATION_TOOLS
      : COMMIT_TOOLS;
  return source.filter((toolName) => isToolAvailable(toolName, availability)) as Array<keyof ToolSet>;
}

function isToolAvailable(toolName: string, availability: HarnessToolAvailability): boolean {
  switch (toolName) {
    case "search_web":
      return availability.searchWeb;
    case "search_reddit":
      return availability.searchReddit;
    case "get_trending_symbols":
      return availability.trendingSymbols;
    case "fetch_url":
      return availability.fetchUrl;
    case "get_quote":
      return availability.getQuote;
    case "get_news":
      return availability.getNews;
    case "get_ohlcv":
      return availability.getOhlcv;
    case "submit_candidates":
      return availability.submitCandidates;
    default:
      return false;
  }
}

function selectorEventsFromStep(step: StepLike): SelectorToolEvent[] {
  const resultsById = new Map<string, unknown>();
  for (const result of step.toolResults ?? []) {
    if (result.toolCallId) resultsById.set(result.toolCallId, result.output);
  }

  return step.toolCalls.map((call) => ({
    tool: String(call.toolName ?? ""),
    input: call.input,
    output: call.toolCallId ? resultsById.get(call.toolCallId) ?? null : null,
  }));
}

function extractSymbolsFromEvent(event: SelectorToolEvent): string[] {
  const out = new Set<string>();

  const directSymbol = normalizeSymbol(readStringField(event.input, "symbol"));
  if (directSymbol) out.add(directSymbol);

  if (event.tool === "get_trending_symbols") {
    for (const item of readArrayField(event.output, "symbols")) {
      const symbol = normalizeSymbol(readStringField(item, "symbol"));
      if (symbol) out.add(symbol);
    }
  }

  if (event.tool === "search_web" || event.tool === "get_news") {
    const results = readArrayField(event.output, "results");
    for (const item of results) {
      for (const token of extractSymbolsFromText(
        [readStringField(item, "title"), readStringField(item, "snippet"), readStringField(item, "query")].filter(Boolean).join(" "),
      )) {
        out.add(token);
      }
    }
  }

  if (event.tool === "search_reddit") {
    const posts = readArrayField(event.output, "posts");
    for (const item of posts) {
      for (const token of extractSymbolsFromText(
        [readStringField(item, "title"), readStringField(item, "body")].filter(Boolean).join(" "),
      )) {
        out.add(token);
      }
    }
  }

  if (event.tool === "fetch_url") {
    for (const token of extractSymbolsFromText(readStringField(event.output, "content") ?? "")) {
      out.add(token);
    }
  }

  return [...out];
}

function extractDomainsFromEvent(event: SelectorToolEvent): string[] {
  const out = new Set<string>();

  if (event.tool === "fetch_url") {
    const url = readStringField(event.output, "url") ?? readStringField(event.input, "url");
    const domain = extractDomain(url);
    if (domain) out.add(domain);
  }

  if (event.tool === "search_web" || event.tool === "get_news") {
    for (const item of readArrayField(event.output, "results")) {
      const domain = extractDomain(readStringField(item, "url"));
      if (domain) out.add(domain);
    }
  }

  if (event.tool === "search_reddit") {
    for (const item of readArrayField(event.output, "posts")) {
      const domain = extractDomain(readStringField(item, "url"));
      if (domain) out.add(domain);
    }
  }

  return [...out];
}

function extractSymbolsFromText(text: string): string[] {
  const matches = text.match(/\b(?:pm:[A-Za-z0-9:_-]+|[A-Z]{2,6}(?:-[A-Z]{2,6})?)\b/g) ?? [];
  const out = new Set<string>();
  for (const match of matches) {
    const symbol = normalizeSymbol(match);
    if (!symbol) continue;
    const base = symbol.startsWith("pm:") ? symbol : symbol.replace(/-USD$/i, "");
    if (COMMON_SYMBOL_TOKENS.has(base.toUpperCase())) continue;
    out.add(symbol);
  }
  return [...out];
}

function extractDomain(urlValue: string | undefined): string | null {
  if (!urlValue) return null;
  try {
    return new URL(urlValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeSymbol(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("pm:") ? trimmed : trimmed.toUpperCase();
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readArrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate : [];
}

export function buildSelectorStepSignature(step: Pick<StepResult<ToolSet>, "toolCalls">): string {
  return step.toolCalls
    .map((call) => `${String(call.toolName)}:${canonicalizeToolInput(String(call.toolName), call.input)}`)
    .join("|");
}

export function canonicalizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return JSON.stringify(input ?? null);
  }

  if (toolName === "search_web" || toolName === "search_reddit") {
    const query = readStringField(input, "query") ?? "";
    return normalizeQueryFamily(query);
  }

  if (toolName === "fetch_url") {
    const url = readStringField(input, "url") ?? "";
    return extractDomain(url) ?? url;
  }

  if (toolName === "get_quote" || toolName === "get_news" || toolName === "get_ohlcv") {
    return normalizeSymbol(readStringField(input, "symbol")) ?? JSON.stringify(input);
  }

  return JSON.stringify(input);
}
