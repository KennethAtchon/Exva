import { and, asc, eq, like, or, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { dataCoverage, ohlcvBars, sessions, trades } from "../../db/schema";
import type { InstrumentSetService } from "../instruments/instrument-set-service";

export type PaletteHitKind =
  | "session"
  | "trade"
  | "instrument"
  | "docs"
  | "settings";

export interface PaletteHit {
  id: string;
  kind: PaletteHitKind;
  title: string;
  subtitle?: string;
  score: number;
  payload: Record<string, string>;
}

export interface PaletteQueryResult {
  query: string;
  hits: PaletteHit[];
}

const SETTINGS_SECTIONS: Array<{
  id: string;
  title: string;
  keywords: string;
}> = [
  {
    id: "accounts",
    title: "Accounts & brokers",
    keywords: "accounts brokers keys",
  },
  {
    id: "strategy",
    title: "Strategy defaults",
    keywords: "strategy presets config",
  },
  {
    id: "notifications",
    title: "Notifications",
    keywords: "ntfy telegram smtp sinks",
  },
  { id: "developer", title: "Developer", keywords: "debug logs developer" },
  { id: "backup", title: "Backup & ops", keywords: "backup database ops" },
];

/**
 * Fan-out entity search for the ⌘K palette. SQLite LIKE + simple recency
 * ranking — enough at single-operator scale (finish-line 08 T1).
 */
export class PaletteQueryService {
  constructor(
    private readonly db: DbClient,
    private readonly instrumentSets: InstrumentSetService,
    private readonly searchDocs: (q: string) => Array<{
      slug: string;
      title: string;
      summary?: string;
    }> = defaultDocSearch,
  ) {}

  query(raw: string, limit = 40): PaletteQueryResult {
    const query = raw.trim();
    if (!query) return { query, hits: [] };
    const likePat = `%${query.replace(/%/g, "")}%`;
    const hits: PaletteHit[] = [];

    const sessionRows = this.db.db
      .select({
        id: sessions.id,
        name: sessions.name,
        status: sessions.status,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(like(sessions.name, likePat))
      .orderBy(asc(sessions.name))
      .limit(12)
      .all();
    for (const row of sessionRows) {
      hits.push({
        id: `session:${row.id}`,
        kind: "session",
        title: row.name,
        subtitle: row.status,
        score: scoreMatch(query, row.name) + recencyBoost(row.updatedAt),
        payload: { sessionId: row.id, status: row.status },
      });
    }

    const tradeRows = this.db.db
      .select({
        id: trades.id,
        symbol: trades.instrumentSymbol,
        status: trades.status,
        side: trades.side,
        openedAt: trades.openedAt,
      })
      .from(trades)
      .where(
        or(like(trades.instrumentSymbol, likePat), like(trades.id, likePat)),
      )
      .orderBy(sql`${trades.openedAt} desc`)
      .limit(12)
      .all();
    for (const row of tradeRows) {
      hits.push({
        id: `trade:${row.id}`,
        kind: "trade",
        title: `${row.symbol} ${row.side}`,
        subtitle: `${row.status} · ${row.id.slice(0, 8)}`,
        score: scoreMatch(query, row.symbol) + recencyBoost(row.openedAt),
        payload: { tradeId: row.id, symbol: row.symbol },
      });
    }

    try {
      const sets = this.instrumentSets.list();
      for (const set of sets) {
        const name = set.name ?? set.setId;
        if (!fuzzyIncludes(name, query) && !fuzzyIncludes(set.setId, query)) {
          continue;
        }
        hits.push({
          id: `instrument-set:${set.setId}`,
          kind: "instrument",
          title: name,
          subtitle: "Instrument set",
          score: scoreMatch(query, name),
          payload: { instrumentSetId: set.setId },
        });
      }
    } catch {
      // Instrument catalog may be empty on fresh DBs.
    }

    const coverageRows = this.db.db
      .select({
        symbol: dataCoverage.symbol,
        timeframe: dataCoverage.timeframe,
      })
      .from(dataCoverage)
      .where(like(dataCoverage.symbol, likePat))
      .limit(10)
      .all();
    for (const row of coverageRows) {
      hits.push({
        id: `market:${row.symbol}:${row.timeframe}`,
        kind: "instrument",
        title: row.symbol,
        subtitle: `Bars · ${row.timeframe}`,
        score: scoreMatch(query, row.symbol),
        payload: { symbol: row.symbol, timeframe: row.timeframe },
      });
    }

    for (const doc of this.searchDocs(query).slice(0, 8)) {
      hits.push({
        id: `docs:${doc.slug}`,
        kind: "docs",
        title: doc.title,
        subtitle: doc.summary ?? "Docs",
        score: scoreMatch(query, doc.title),
        payload: { slug: doc.slug },
      });
    }

    for (const section of SETTINGS_SECTIONS) {
      if (
        !fuzzyIncludes(section.title, query) &&
        !fuzzyIncludes(section.keywords, query)
      ) {
        continue;
      }
      hits.push({
        id: `settings:${section.id}`,
        kind: "settings",
        title: section.title,
        subtitle: "Settings",
        score: scoreMatch(query, section.title),
        payload: { settingsTab: section.id },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return { query, hits: hits.slice(0, limit) };
  }
}

function fuzzyIncludes(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function scoreMatch(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  return 10;
}

function recencyBoost(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ageMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const days = ageMs / (24 * 60 * 60 * 1000);
  return Math.max(0, 20 - days);
}

export function listCoverageSymbols(db: DbClient): Array<{
  symbol: string;
  timeframe: string;
  firstTs: string;
  lastTs: string;
  provider: string;
  feed: string | null;
}> {
  return db.db
    .select({
      symbol: dataCoverage.symbol,
      timeframe: dataCoverage.timeframe,
      firstTs: dataCoverage.firstTs,
      lastTs: dataCoverage.lastTs,
      provider: dataCoverage.provider,
      feed: dataCoverage.feed,
    })
    .from(dataCoverage)
    .orderBy(asc(dataCoverage.symbol), asc(dataCoverage.timeframe))
    .all();
}

export function listBarsInCoverage(
  db: DbClient,
  symbol: string,
  timeframe: string,
): string[] {
  return db.db
    .select({ ts: ohlcvBars.ts })
    .from(ohlcvBars)
    .where(
      and(eq(ohlcvBars.symbol, symbol), eq(ohlcvBars.timeframe, timeframe)),
    )
    .orderBy(asc(ohlcvBars.ts))
    .all()
    .map((r) => r.ts);
}

export function expectedBarMs(timeframe: string): number {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    default:
      return 60 * 60_000;
  }
}

const BUILTIN_DOCS: Array<{ slug: string; title: string; summary: string }> = [
  {
    slug: "app-pages",
    title: "App pages & hubs",
    summary: "Five operator hubs",
  },
  {
    slug: "glossary",
    title: "Glossary",
    summary: "Operator terms",
  },
  {
    slug: "supervisor",
    title: "Supervisor & alarms",
    summary: "Kill switches and digests",
  },
  {
    slug: "promotion-ladder",
    title: "Promotion ladder",
    summary: "Research → live capital",
  },
  {
    slug: "command-palette",
    title: "Command palette",
    summary: "⌘K actions and search",
  },
  {
    slug: "backtest-lab",
    title: "Backtest Lab",
    summary: "Run, compare, sweep",
  },
  {
    slug: "data-doctor",
    title: "Data Doctor",
    summary: "Coverage and gaps",
  },
  {
    slug: "morning-briefing",
    title: "Morning briefing",
    summary: "Nightly operator digest",
  },
];

function defaultDocSearch(q: string): Array<{
  slug: string;
  title: string;
  summary?: string;
}> {
  const needle = q.toLowerCase();
  return BUILTIN_DOCS.filter(
    (d) =>
      d.title.toLowerCase().includes(needle) ||
      d.slug.includes(needle) ||
      d.summary.toLowerCase().includes(needle),
  );
}
