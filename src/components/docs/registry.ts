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
import { ExperiencesPage } from "./pages/ExperiencesPage";
import { PipelinePage } from "./pages/PipelinePage";
import { SessionsDocPage } from "./pages/SessionsDocPage";
import { EnvironmentPage } from "./pages/EnvironmentPage";
import { AppPagesPage } from "./pages/AppPagesPage";
import { GlossaryPage } from "./pages/GlossaryPage";

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
    headings: [],
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
    headings: [],
    component: EdgarPipelinePage,
  },
  {
    slug: "signal-source-types",
    title: "Signal source types",
    description: "edgar_8k, timer, mock, web_search, manual, prediction_event.",
    category: "Signals",
    order: 120,
    related: ["edgar-overview", "experiences"],
    headings: [],
    component: SignalSourceTypesPage,
  },
  {
    slug: "experiences",
    title: "Experiences",
    description: "Packaged trading setups and capability declarations.",
    category: "Operations",
    order: 130,
    related: ["core-concepts", "edgar-pipeline", "signal-source-types"],
    headings: [],
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
    headings: [],
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
      "edgar-overview",
      "edgar-detection",
      "edgar-item-codes",
      "edgar-tradability",
      "edgar-pipeline",
      "signal-source-types",
    ],
  },
  {
    id: "operations",
    label: "Operations",
    slugs: ["experiences", "pipeline", "sessions", "environment"],
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
