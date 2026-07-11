import type { ReactNode } from "react";

export type DocSlug =
  | "introduction"
  | "quickstart"
  | "architecture"
  | "core-concepts"
  | "signal-architecture"
  | "edgar-overview"
  | "edgar-detection"
  | "edgar-item-codes"
  | "edgar-tradability"
  | "edgar-pipeline"
  | "signal-source-types"
  | "prediction-events"
  | "timer-signals"
  | "mock-manual-sources"
  | "options-flow-edge"
  | "experiences"
  | "pipeline"
  | "sessions"
  | "environment"
  | "strategy"
  | "strategy-style"
  | "strategy-rules"
  | "risk"
  | "timeframes"
  | "ai-phases"
  | "autopsy"
  | "trades"
  | "dashboard"
  | "leaderboard"
  | "cost-tracking"
  | "accounts-brokers"
  | "app-pages"
  | "glossary";

export type DocHeadingAnchor = {
  id: string;
  title: string;
  level: 2 | 3;
};

export type DocPageDefinition = {
  slug: DocSlug;
  title: string;
  description: string;
  category: string;
  order: number;
  related?: DocSlug[];
  headings: DocHeadingAnchor[];
  component: () => ReactNode;
};

export type DocNavGroup = {
  id: string;
  label: string;
  slugs: DocSlug[];
  subgroups?: DocNavGroup[];
};
