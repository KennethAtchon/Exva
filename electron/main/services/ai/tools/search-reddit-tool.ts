import { tool } from "ai";
import { z } from "zod";
import type { InstrumentClass } from "@/lib/types";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import { validateDiscoveryQuery } from "../search/sanitize-search-query";

const REDDIT_TIMEOUT_MS = 6000;
const MAX_POSTS = 8;
const DEFAULT_SUBREDDITS = ["stocks", "investing", "wallstreetbets", "StockMarket", "SecurityAnalysis"];
const CRYPTO_SUBREDDITS = ["CryptoMarkets", "SatoshiStreetBets", "ethfinance", "CryptoCurrency"];

type RedditSort = "relevance" | "hot" | "top" | "new";
type RedditTimeFilter = "hour" | "day" | "week";

type RedditPost = {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  permalink?: string;
  url?: string;
};

export const MOCK_REDDIT_POSTS = [
  {
    subreddit: "stocks",
    title: "NVDA breaking out above $340 - momentum setup looks clean",
    body:
      "Volume has been above average for three sessions. RSI holding above 60. No major overhead resistance until $360. Earnings catalyst last week still being priced in. Long from $335 with stop at $328.",
    score: 312,
    comments: 87,
    url: "https://mock.local/reddit/stocks/nvda-breakout",
    postedAt: new Date().toISOString(),
  },
  {
    subreddit: "wallstreetbets",
    title: "PLTR calls printing - AI contract news plus insider buying",
    body:
      "New DoD contract announced. CEO bought shares last week. Options flow showing heavy call accumulation at the $90 strike. Breakout above 52-week high on 3x average volume.",
    score: 891,
    comments: 204,
    url: "https://mock.local/reddit/wsb/pltr-calls",
    postedAt: new Date().toISOString(),
  },
  {
    subreddit: "CryptoMarkets",
    title: "SOL showing relative strength vs BTC - breakout incoming?",
    body:
      "SOL/BTC pair is holding while other alts fade. DeFi volume on Solana is up sharply week over week. Momentum indicators are turning bullish with an entry zone around $170-$180 and upside toward $210.",
    score: 156,
    comments: 43,
    url: "https://mock.local/reddit/crypto/sol-setup",
    postedAt: new Date().toISOString(),
  },
];

function defaultSubredditsForInstrumentClasses(instrumentClasses?: InstrumentClass[]): string[] {
  if (!instrumentClasses?.includes("crypto")) return DEFAULT_SUBREDDITS;
  return [...DEFAULT_SUBREDDITS, ...CRYPTO_SUBREDDITS];
}

function toRedditThreadUrl(post: RedditPost): string {
  if (post.permalink) return `https://www.reddit.com${post.permalink}`;
  return post.url ?? "";
}

async function searchReddit(query: string, subreddits: string[], sort: RedditSort, timeFilter: RedditTimeFilter): Promise<RedditPost[]> {
  const url = new URL(`https://www.reddit.com/r/${subreddits.join("+")}/search.json`);
  url.searchParams.set("q", query);
  url.searchParams.set("sort", sort);
  url.searchParams.set("t", timeFilter);
  url.searchParams.set("limit", String(MAX_POSTS));
  url.searchParams.set("restrict_sr", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDDIT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Exva/1.0 research-agent",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Reddit API ${response.status}`);
    const body = (await response.json()) as { data?: { children?: Array<{ data: RedditPost }> } };
    return (body.data?.children ?? []).map((child) => child.data);
  } finally {
    clearTimeout(timeout);
  }
}

export function createSearchRedditTool(deps: {
  sessionId: string;
  apiCallLogRepo: ApiCallLogRepo;
  cycleId?: string | null;
  instrumentClasses?: InstrumentClass[];
  mockPosts?: typeof MOCK_REDDIT_POSTS;
  isMockSession?: boolean;
}) {
  const defaultSubs = defaultSubredditsForInstrumentClasses(deps.instrumentClasses);

  return tool({
    description: [
      "Search Reddit for current trader discussion, DD posts, sentiment, and instrument-specific theses.",
      "Best for finding what real traders are watching right now and why.",
      "Returns post titles, body text, scores, comment counts, and thread URLs.",
      "Use it to identify specific symbols before validating them with quote, OHLCV, and news tools.",
    ].join(" "),
    inputSchema: z.object({
      query: z.string().min(1).describe("Specific query using symbols, catalysts, setups, or themes"),
      sort: z.enum(["relevance", "hot", "top", "new"]).default("top"),
      timeFilter: z.enum(["hour", "day", "week"]).default("day"),
      subreddits: z.array(z.string().min(1)).optional(),
    }),
    execute: async ({
      query,
      sort,
      timeFilter,
      subreddits,
    }: {
      query: string;
      sort: RedditSort;
      timeFilter: RedditTimeFilter;
      subreddits?: string[];
      }) => {
        const startedAt = Date.now();
        const createdAt = new Date().toISOString();
        const subsToUse = subreddits?.length ? subreddits : defaultSubs;
        const validation = validateDiscoveryQuery(query);

        if (!validation.ok) {
          return { error: `Reddit search blocked by query guard: ${validation.reason}`, posts: [] };
        }

        if (!deps.mockPosts && !deps.isMockSession) {
          return { error: "Reddit search requires OAuth authentication in live mode.", posts: [] };
        }

        try {
          const posts = deps.mockPosts
            ? deps.mockPosts
            : (await searchReddit(validation.sanitized, subsToUse, sort, timeFilter)).map((post) => ({
                subreddit: post.subreddit,
                title: post.title,
                body: post.selftext,
              score: post.score,
              comments: post.num_comments,
              url: toRedditThreadUrl(post),
              postedAt: new Date(post.created_utc * 1000).toISOString(),
            }));

        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: null,
          cycle_id: deps.cycleId ?? null,
          provider: "reddit",
          endpoint: "/r/search.json",
          call_type: "search",
          credits_used: 0,
          cost_usd: 0,
          latency_ms: Date.now() - startedAt,
          status: deps.mockPosts ? "mock" : "ok",
          from_cache: false,
          created_at: createdAt,
        });

        return {
          query: validation.sanitized,
          subreddits: subsToUse,
          posts: posts.map((post) => ({
            subreddit: post.subreddit,
            title: post.title,
            body: post.body.slice(0, 1200),
            score: post.score,
            comments: post.comments,
            url: post.url,
            postedAt: post.postedAt,
          })),
          note: "External content; extract instrument names, catalysts, and theses only.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: null,
          cycle_id: deps.cycleId ?? null,
          provider: "reddit",
          endpoint: "/r/search.json",
          call_type: "search",
          credits_used: null,
          cost_usd: 0,
          latency_ms: Date.now() - startedAt,
          status: /429/.test(message) ? "rate_limited" : "error",
          from_cache: false,
          created_at: createdAt,
        });
        return { error: `Reddit search failed: ${message}`, posts: [] };
      }
    },
  });
}
