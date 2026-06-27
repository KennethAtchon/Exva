import type { DocNavGroup, DocPageDefinition, DocSlug } from "./types";
import { IntroductionPage } from "./pages/IntroductionPage";
import { QuickstartPage } from "./pages/QuickstartPage";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { CoreConceptsPage } from "./pages/CoreConceptsPage";
import { SignalArchitecturePage } from "./pages/SignalArchitecturePage";
import { EdgarOverviewPage } from "./pages/EdgarOverviewPage";
import { EdgarDetectionPage } from "./pages/EdgarDetectionPage";
import { EdgarItemCodesPage } from "./pages/EdgarItemCodesPage";
import { EdgarTradabilityPage } from "./pages/EdgarTradabilityPage";
import { EdgarPipelinePage } from "./pages/EdgarPipelinePage";
import { SignalSourceTypesPage } from "./pages/SignalSourceTypesPage";
import { PredictionEventsPage } from "./pages/PredictionEventsPage";
import { WebSearchSignalPage } from "./pages/WebSearchSignalPage";
import { TimerSignalPage } from "./pages/TimerSignalPage";
import { MockManualSourcesPage } from "./pages/MockManualSourcesPage";
import { OptionsFlowEdgePage } from "./pages/OptionsFlowEdgePage";
import { ExperiencesPage } from "./pages/ExperiencesPage";
import { PipelinePage } from "./pages/PipelinePage";
import { SessionsDocPage } from "./pages/SessionsDocPage";
import { EnvironmentPage } from "./pages/EnvironmentPage";
import { AppPagesPage } from "./pages/AppPagesPage";
import { GlossaryPage } from "./pages/GlossaryPage";
import { StrategyOverviewPage } from "./pages/StrategyOverviewPage";
import { StrategyStylePage } from "./pages/StrategyStylePage";
import { StrategyRulesPage } from "./pages/StrategyRulesPage";
import { RiskPage } from "./pages/RiskPage";
import { TimeframesPage } from "./pages/TimeframesPage";
import { AiPhasesConfigPage } from "./pages/AiPhasesConfigPage";
import { AutopsyPage } from "./pages/AutopsyPage";
import { TradesDocPage } from "./pages/TradesPage";
import { DashboardDocPage } from "./pages/DashboardDocPage";
import { LeaderboardDocPage } from "./pages/LeaderboardPage";
import { CostTrackingPage } from "./pages/CostTrackingPage";
import { AccountsBrokersPage } from "./pages/AccountsBrokersPage";

export const DEFAULT_DOC_SLUG: DocSlug = "introduction";

const DOC_PAGES: DocPageDefinition[] = [
  {
    slug: "introduction",
    title: "Introduction",
    description: "What Exva is and how the documentation is organized.",
    category: "Getting started",
    order: 10,
    related: ["quickstart", "core-concepts", "architecture"],
    headings: [],
    component: IntroductionPage,
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    description:
      "First-run setup from accounts through your first paper session.",
    category: "Getting started",
    order: 20,
    related: ["introduction", "signal-architecture", "sessions"],
    headings: [],
    component: QuickstartPage,
  },
  {
    slug: "architecture",
    title: "System architecture",
    description: "Electron layout, main-process services, and data flow.",
    category: "Architecture",
    order: 30,
    related: ["signal-architecture", "pipeline"],
    headings: [{ id: "system-overview", title: "System overview", level: 2 }],
    component: ArchitecturePage,
  },
  {
    slug: "core-concepts",
    title: "Core concepts",
    description: "Experiences, sessions, signals, pipelines, and dead letters.",
    category: "Concepts",
    order: 40,
    related: ["glossary", "experiences", "signal-architecture"],
    headings: [],
    component: CoreConceptsPage,
  },
  {
    slug: "glossary",
    title: "Glossary",
    description: "Definitions for terms used across Exva.",
    category: "Concepts",
    order: 50,
    related: ["core-concepts"],
    headings: [
      { id: "term-accession", title: "Accession number", level: 2 },
      { id: "term-cik", title: "CIK", level: 2 },
      { id: "term-catalyst", title: "Catalyst", level: 2 },
      { id: "term-dead-letter", title: "Dead letter", level: 2 },
      { id: "term-experience", title: "Experience", level: 2 },
      { id: "term-instrument-class", title: "Instrument class", level: 2 },
      { id: "term-signalbus", title: "SignalBus", level: 2 },
      { id: "term-tradability", title: "Tradability", level: 2 },
    ],
    component: GlossaryPage,
  },
  {
    slug: "signal-architecture",
    title: "Signal architecture",
    description: "Detection through delivery, queuing, and pipeline trigger.",
    category: "Signals",
    order: 60,
    related: ["edgar-overview", "signal-source-types", "sessions"],
    headings: [
      { id: "end-to-end-flow", title: "End-to-end flow", level: 2 },
      { id: "source-readiness", title: "Source readiness states", level: 2 },
    ],
    component: SignalArchitecturePage,
  },
  {
    slug: "edgar-overview",
    title: "EDGAR 8-K overview",
    description: "SEC filing feed, catalyst trading, and related doc map.",
    category: "Signals",
    order: 70,
    related: [
      "edgar-detection",
      "edgar-item-codes",
      "edgar-tradability",
      "edgar-pipeline",
    ],
    headings: [],
    component: EdgarOverviewPage,
  },
  {
    slug: "edgar-detection",
    title: "EDGAR detection",
    description: "Atom feed polling, CIK resolution, and filter pipeline.",
    category: "Signals",
    order: 80,
    related: ["edgar-item-codes", "edgar-overview", "signal-architecture"],
    headings: [
      { id: "data-source", title: "Data source", level: 2 },
      { id: "filter-pipeline", title: "Filter pipeline", level: 2 },
    ],
    component: EdgarDetectionPage,
  },
  {
    slug: "edgar-item-codes",
    title: "8-K item codes",
    description: "SEC item numbers Exva parses and filters on.",
    category: "Signals",
    order: 90,
    related: ["edgar-detection", "edgar-overview"],
    headings: [
      { id: "research-codes", title: "Tracked item codes", level: 2 },
      { id: "recommended-whitelist", title: "Recommended whitelist", level: 2 },
    ],
    component: EdgarItemCodesPage,
  },
  {
    slug: "edgar-tradability",
    title: "EDGAR tradability",
    description: "Liquidity and quality filters before AI analysis.",
    category: "Signals",
    order: 100,
    related: ["edgar-pipeline", "edgar-detection"],
    headings: [],
    component: EdgarTradabilityPage,
  },
  {
    slug: "edgar-pipeline",
    title: "EDGAR pipeline",
    description: "edgar-8k-cycle stages from catalyst analysis to risk gate.",
    category: "Signals",
    order: 110,
    related: ["pipeline", "edgar-tradability", "experiences"],
    headings: [
      { id: "pipeline-flow", title: "Pipeline flow", level: 2 },
      { id: "stages", title: "Stages", level: 2 },
    ],
    component: EdgarPipelinePage,
  },
  {
    slug: "signal-source-types",
    title: "Signal source types",
    description: "edgar_8k, timer, mock, web_search, manual, prediction_event.",
    category: "Signals",
    order: 65,
    related: [
      "edgar-overview",
      "prediction-events",
      "timer-signals",
      "experiences",
    ],
    headings: [],
    component: SignalSourceTypesPage,
  },
  {
    slug: "prediction-events",
    title: "Prediction events",
    description:
      "How the Polymarket scanner finds dislocated odds and feeds the Prediction Event Edge pipeline.",
    category: "Signals",
    order: 113,
    related: ["signal-source-types", "experiences"],
    headings: [
      { id: "how-it-works", title: "How it works", level: 2 },
      { id: "dislocation", title: "What interesting means", level: 2 },
      { id: "downstream", title: "After a signal fires", level: 2 },
      { id: "trigger-kinds", title: "Trigger kinds", level: 2 },
      { id: "filters", title: "Filter checklist", level: 2 },
      { id: "signal-payload", title: "What's in a signal", level: 2 },
      { id: "configuration", title: "Configuration", level: 2 },
    ],
    component: PredictionEventsPage,
  },
  {
    slug: "web-search",
    title: "Web search",
    description: "Legacy discovery wrapper and registry fallback source.",
    category: "Signals",
    order: 122,
    related: ["signal-source-types", "edgar-overview"],
    headings: [],
    component: WebSearchSignalPage,
  },
  {
    slug: "timer-signals",
    title: "Timer signals",
    description: "Clock-driven ticks per symbol and cadence for rules engines.",
    category: "Signals",
    order: 124,
    related: ["signal-source-types", "pipeline"],
    headings: [
      { id: "configuration", title: "Configuration", level: 2 },
      { id: "cadence", title: "Cadence & payload", level: 2 },
    ],
    component: TimerSignalPage,
  },
  {
    slug: "mock-manual-sources",
    title: "Mock & manual sources",
    description: "Synthetic test signals and operator-driven manual tickers.",
    category: "Signals",
    order: 126,
    related: ["signal-source-types", "sessions"],
    headings: [
      { id: "mock", title: "Mock", level: 2 },
      { id: "manual", title: "Manual", level: 2 },
    ],
    component: MockManualSourcesPage,
  },
  {
    slug: "options-flow-edge",
    title: "Options Flow Edge",
    description:
      "Unusual options activity (UOA) detection and directional trading on liquid underlyings.",
    category: "Signals",
    order: 128,
    related: ["signal-source-types", "experiences", "timer-signals"],
    headings: [
      { id: "how-it-works", title: "How it works", level: 2 },
      { id: "why-search", title: "Why most flow is ignored", level: 2 },
      { id: "configuration", title: "Configuration", level: 2 },
      { id: "roadmap", title: "Contract-level execution (next phase)", level: 2 },
    ],
    component: OptionsFlowEdgePage,
  },
  {
    slug: "experiences",
    title: "Experiences",
    description:
      "Trading themes, toggleable signals, pipelines, and capability declarations.",
    category: "Operations",
    order: 130,
    related: ["core-concepts", "edgar-pipeline", "signal-source-types"],
    headings: [
      { id: "anatomy", title: "Anatomy of an experience", level: 2 },
      { id: "lifecycle", title: "From signal to trade", level: 2 },
      { id: "edgar", title: "EDGAR 8-K catalyst drift", level: 2 },
      { id: "rules", title: "Rule-based experiences (timer)", level: 2 },
      { id: "prediction", title: "Prediction event edge", level: 2 },
    ],
    component: ExperiencesPage,
  },
  {
    slug: "pipeline",
    title: "Pipeline & AI phases",
    description:
      "Selector, technical, fundamental, review, and decision phases.",
    category: "Operations",
    order: 140,
    related: ["edgar-pipeline", "architecture"],
    headings: [
      { id: "execution-flow", title: "Execution flow", level: 2 },
      { id: "ai-phases", title: "AI phases", level: 2 },
    ],
    component: PipelinePage,
  },
  {
    slug: "sessions",
    title: "Sessions & lifecycle",
    description: "Statuses, header controls, and signal delivery states.",
    category: "Operations",
    order: 150,
    related: ["signal-architecture", "environment", "quickstart"],
    headings: [
      { id: "session-lifecycle", title: "Session lifecycle", level: 2 },
      { id: "session-statuses", title: "Session statuses", level: 2 },
      { id: "header-controls", title: "Header controls", level: 2 },
      { id: "delivery-statuses", title: "Signal delivery statuses", level: 2 },
    ],
    component: SessionsDocPage,
  },
  {
    slug: "environment",
    title: "Environment & execution",
    description: "Paper vs live modes, view scope, and readiness gates.",
    category: "Operations",
    order: 160,
    related: ["sessions", "quickstart"],
    headings: [],
    component: EnvironmentPage,
  },
  {
    slug: "strategy",
    title: "Strategy configuration",
    description: "The five strategy sections, presets, and edit-lock behavior.",
    category: "Strategy",
    order: 131,
    related: ["strategy-style", "strategy-rules", "risk", "timeframes"],
    headings: [
      { id: "sections", title: "The five sections", level: 2 },
      { id: "presets", title: "Global strategy presets", level: 2 },
      { id: "lock", title: "Edit-lock behavior", level: 2 },
      { id: "saving", title: "Saving & validation", level: 2 },
    ],
    component: StrategyOverviewPage,
  },
  {
    slug: "strategy-style",
    title: "Style & research posture",
    description: "Processing mode, evidence bias, catalyst, and fundamentals.",
    category: "Strategy",
    order: 132,
    related: ["strategy", "strategy-rules", "ai-phases"],
    headings: [
      { id: "fields", title: "Posture fields", level: 2 },
      { id: "presets", title: "Built-in style presets", level: 2 },
      { id: "notes", title: "Posture notes vs. worker instructions", level: 2 },
    ],
    component: StrategyStylePage,
  },
  {
    slug: "strategy-rules",
    title: "Trade rules",
    description: "Setup type, side bias, entry/exit style, and scaling.",
    category: "Strategy",
    order: 133,
    related: ["strategy", "strategy-style", "risk"],
    headings: [
      { id: "fields", title: "Rule fields", level: 2 },
      { id: "presets", title: "Built-in rule presets", level: 2 },
    ],
    component: StrategyRulesPage,
  },
  {
    slug: "risk",
    title: "Risk & position sizing",
    description: "Risk config fields, per-trade gates, sizing, and stops.",
    category: "Strategy",
    order: 134,
    related: ["strategy", "timeframes", "cost-tracking"],
    headings: [
      { id: "fields", title: "Risk config fields", level: 2 },
      { id: "gates", title: "How risk is calculated per trade", level: 2 },
      { id: "stops", title: "Stops & approval", level: 2 },
      { id: "presets", title: "Risk presets", level: 2 },
    ],
    component: RiskPage,
  },
  {
    slug: "timeframes",
    title: "Timeframes & holding horizon",
    description: "Primary bar size, holding style, and hold windows.",
    category: "Strategy",
    order: 135,
    related: ["strategy", "strategy-style", "risk"],
    headings: [
      { id: "fields", title: "Timeframe fields", level: 2 },
      { id: "presets", title: "Timeframe presets", level: 2 },
      { id: "effect", title: "How timeframe reaches the trade", level: 2 },
    ],
    component: TimeframesPage,
  },
  {
    slug: "ai-phases",
    title: "AI phase configuration",
    description: "Per-phase model, prompt, reasoning, and worker guidance.",
    category: "Strategy",
    order: 136,
    related: ["pipeline", "strategy", "cost-tracking"],
    headings: [
      { id: "phases", title: "Configurable phases", level: 2 },
      { id: "fields", title: "Per-phase fields", level: 2 },
      { id: "guidance", title: "Worker guidance", level: 2 },
      { id: "tools", title: "Worker tools", level: 2 },
    ],
    component: AiPhasesConfigPage,
  },
  {
    slug: "dashboard",
    title: "Dashboard & metrics",
    description: "Scope, header metrics, agent feed, and approval queue.",
    category: "Analytics",
    order: 162,
    related: ["trades", "environment", "cost-tracking"],
    headings: [
      { id: "scope", title: "Scope", level: 2 },
      { id: "metrics", title: "Header metrics", level: 2 },
      { id: "approvals", title: "Approval queue", level: 2 },
    ],
    component: DashboardDocPage,
  },
  {
    slug: "trades",
    title: "Trades & positions",
    description: "Trade statuses, detail view, and cost attribution.",
    category: "Analytics",
    order: 163,
    related: ["dashboard", "autopsy", "risk"],
    headings: [
      { id: "status", title: "Trade statuses", level: 2 },
      { id: "detail", title: "Trade detail", level: 2 },
      { id: "cost", title: "Cost attribution", level: 2 },
    ],
    component: TradesDocPage,
  },
  {
    slug: "autopsy",
    title: "Autopsy",
    description: "Period and trade-level post-mortems, lessons, Andon Cord.",
    category: "Analytics",
    order: 164,
    related: ["trades", "leaderboard"],
    headings: [
      { id: "period", title: "Period autopsy", level: 2 },
      { id: "lessons", title: "Lessons", level: 2 },
      { id: "andon", title: "Andon Cord", level: 2 },
      { id: "trade-review", title: "Trade review", level: 2 },
    ],
    component: AutopsyPage,
  },
  {
    slug: "leaderboard",
    title: "Leaderboard & promotion",
    description: "Experience scorecards and the promotion ladder.",
    category: "Analytics",
    order: 165,
    related: ["experiences", "autopsy"],
    headings: [
      { id: "promotion", title: "Promotion ladder", level: 2 },
      { id: "metrics", title: "Scorecard metrics", level: 2 },
    ],
    component: LeaderboardDocPage,
  },
  {
    slug: "cost-tracking",
    title: "AI cost & budgets",
    description: "Spend metering, budgets, and cost attribution.",
    category: "Analytics",
    order: 166,
    related: ["ai-phases", "risk"],
    headings: [
      { id: "budgets", title: "Budgets & caps", level: 2 },
      { id: "breakdown", title: "Breakdown views", level: 2 },
    ],
    component: CostTrackingPage,
  },
  {
    slug: "accounts-brokers",
    title: "Accounts & brokers",
    description: "Credentials, providers, broker routing, and allocation.",
    category: "Setup",
    order: 167,
    related: ["environment", "sessions"],
    headings: [
      { id: "accounts", title: "Accounts", level: 2 },
      { id: "brokers", title: "Brokers", level: 2 },
    ],
    component: AccountsBrokersPage,
  },
  {
    slug: "app-pages",
    title: "Application pages",
    description: "Reference map of every major page in the app.",
    category: "Reference",
    order: 170,
    related: ["quickstart"],
    headings: [],
    component: AppPagesPage,
  },
];

export const DOC_NAV_GROUPS: DocNavGroup[] = [
  {
    id: "getting-started",
    label: "Getting started",
    slugs: ["introduction", "quickstart"],
  },
  {
    id: "concepts",
    label: "Concepts",
    slugs: ["core-concepts", "glossary"],
  },
  {
    id: "architecture",
    label: "Architecture",
    slugs: ["architecture", "signal-architecture"],
  },
  {
    id: "signals",
    label: "Signals",
    slugs: [
      "signal-source-types",
      "prediction-events",
      "web-search",
      "timer-signals",
      "mock-manual-sources",
      "options-flow-edge",
    ],
    subgroups: [
      {
        id: "edgar",
        label: "EDGAR 8-K",
        slugs: [
          "edgar-overview",
          "edgar-detection",
          "edgar-item-codes",
          "edgar-tradability",
          "edgar-pipeline",
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    slugs: ["experiences", "pipeline", "sessions", "environment"],
  },
  {
    id: "strategy",
    label: "Strategy",
    slugs: [
      "strategy",
      "strategy-style",
      "strategy-rules",
      "risk",
      "timeframes",
      "ai-phases",
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    slugs: ["dashboard", "trades", "autopsy", "leaderboard", "cost-tracking"],
  },
  {
    id: "setup",
    label: "Setup",
    slugs: ["accounts-brokers"],
  },
  {
    id: "reference",
    label: "Reference",
    slugs: ["app-pages"],
  },
];

const pageBySlug = new Map(DOC_PAGES.map((page) => [page.slug, page]));

export function getDocPage(slug: DocSlug): DocPageDefinition {
  const page = pageBySlug.get(slug);
  if (!page) throw new Error(`Unknown doc slug: ${slug}`);
  return page;
}

export function listDocPages(): DocPageDefinition[] {
  return [...DOC_PAGES].sort((a, b) => a.order - b.order);
}

export function getDocPager(slug: DocSlug): {
  previous: DocPageDefinition | null;
  next: DocPageDefinition | null;
} {
  const pages = listDocPages();
  const index = pages.findIndex((page) => page.slug === slug);
  return {
    previous: index > 0 ? (pages.at(index - 1) ?? null) : null,
    next: index < pages.length - 1 ? (pages.at(index + 1) ?? null) : null,
  };
}

/**
 * The chain of nav groups from the top-level group down to the innermost group
 * that directly contains the slug. Drives breadcrumbs and sidebar ancestor
 * expansion. Empty if the slug is not in the nav tree.
 */
export function getDocGroupTrail(slug: DocSlug): DocNavGroup[] {
  const walk = (groups: DocNavGroup[], trail: DocNavGroup[]): DocNavGroup[] => {
    for (const group of groups) {
      const next = [...trail, group];
      if (group.slugs.includes(slug)) return next;
      if (group.subgroups) {
        const found = walk(group.subgroups, next);
        if (found.length) return found;
      }
    }
    return [];
  };
  return walk(DOC_NAV_GROUPS, []);
}

export function searchDocPages(query: string): DocPageDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return listDocPages();
  return listDocPages().filter(
    (page) =>
      page.title.toLowerCase().includes(normalized) ||
      page.description.toLowerCase().includes(normalized) ||
      page.category.toLowerCase().includes(normalized),
  );
}
