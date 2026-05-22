export type MockScenarioKind =
  | "clean_breakout"
  | "failed_breakout"
  | "sideways_chop"
  | "gap_down_after_entry"
  | "news_reversal"
  | "stale_quote"
  | "wide_spread"
  | "partial_fill"
  | "broker_reject"
  | "rate_limit";

type RedditPost = {
  subreddit: string;
  title: string;
  body: string;
  score: number;
  comments: number;
  url: string;
  postedAt: string;
};

type NewsItem = {
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
};

type TrendingSymbol = {
  symbol: string;
  name: string;
  messageVolume: number;
  sentiment: string;
  watchlistCount: number;
};

export const SCENARIO_REDDIT: Record<MockScenarioKind, RedditPost[]> = {
  clean_breakout: [
    {
      subreddit: "stocks",
      title: "{symbol} breaking out on volume — textbook continuation setup",
      body: "Volume surging, RSI holding above 60, clean break above prior resistance. Structure looks constructive for continuation. Long with stop below the breakout level.",
      score: 524,
      comments: 112,
      url: "https://mock.local/reddit/clean_breakout/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "SecurityAnalysis",
      title:
        "Positioning into {symbol} breakout — catalyst still being absorbed",
      body: "Institutional buying visible in block tape. Float rotation looks clean. Setup matches prior catalyst-driven breakouts with multi-day follow-through.",
      score: 288,
      comments: 64,
      url: "https://mock.local/reddit/clean_breakout/2",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "wallstreetbets",
      title: "{symbol} ripping — not chasing but watching for a pullback entry",
      body: "Already up 12% this week but the structure is too clean to ignore. Waiting for a measured move retrace to the 8-period EMA.",
      score: 431,
      comments: 98,
      url: "https://mock.local/reddit/clean_breakout/3",
      postedAt: new Date().toISOString(),
    },
  ],
  failed_breakout: [
    {
      subreddit: "stocks",
      title: "{symbol} failed breakout — bulls look trapped above resistance",
      body: "Price rejected hard at prior highs and is now back below the level. Volume was light on the push and heavy on the rejection. Distribution pattern forming.",
      score: 341,
      comments: 97,
      url: "https://mock.local/reddit/failed_breakout/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "wallstreetbets",
      title: "Fading {symbol} — bears win this round",
      body: "Called this exact rejection two days ago. Sellers are clearly in control. Next stop is the prior support range or lower. Stop is above today's high.",
      score: 187,
      comments: 53,
      url: "https://mock.local/reddit/failed_breakout/2",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "investing",
      title: "{symbol} technicals deteriorating after failed test of highs",
      body: "Chart is weakening. RSI rolling over below 50. Momentum is clearly on the sell side. If you were long, this was the signal to exit or at least trim.",
      score: 92,
      comments: 29,
      url: "https://mock.local/reddit/failed_breakout/3",
      postedAt: new Date().toISOString(),
    },
  ],
  sideways_chop: [
    {
      subreddit: "investing",
      title: "{symbol} going nowhere — range-bound for two weeks",
      body: "Price keeps bouncing between the same support and resistance. No clean directional edge. Sitting this one out until it resolves one way or another.",
      score: 74,
      comments: 21,
      url: "https://mock.local/reddit/sideways_chop/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "StockMarket",
      title: "Mixed read on {symbol} — technicals neutral",
      body: "Neither bulls nor bears have a clear advantage here. Volume is flat. The market is waiting for a catalyst to break this coil. Risk/reward isn't there yet.",
      score: 43,
      comments: 11,
      url: "https://mock.local/reddit/sideways_chop/2",
      postedAt: new Date().toISOString(),
    },
  ],
  gap_down_after_entry: [
    {
      subreddit: "wallstreetbets",
      title: "{symbol} dumping pre-market — what happened",
      body: "Down 8% pre-market on earnings miss. Guidance cut severely. This is not a dip buy situation. The fundamental thesis is broken. Get out while you can.",
      score: 1142,
      comments: 387,
      url: "https://mock.local/reddit/gap_down/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "stocks",
      title: "Getting stopped out of {symbol} — gap risk is real",
      body: "Entry was solid, setup was clean, but overnight gap blew straight through my stop. Nothing to do but manage the exit here. Lesson: size down near earnings.",
      score: 213,
      comments: 61,
      url: "https://mock.local/reddit/gap_down/2",
      postedAt: new Date().toISOString(),
    },
  ],
  news_reversal: [
    {
      subreddit: "stocks",
      title:
        "{symbol} chart looks good but news is terrible — conflicting signals",
      body: "Technically the setup is there — higher lows, volume building, clean breakout structure — but the CEO just resigned and guidance was cut 30%. Hard to go long with that kind of fundamental deterioration.",
      score: 398,
      comments: 104,
      url: "https://mock.local/reddit/news_reversal/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "SecurityAnalysis",
      title: "Bullish chart, bearish fundamentals on {symbol} — what wins?",
      body: "Technical momentum has been building for two weeks, but the earnings report was a disaster. Management credibility is shot. Historically, news trumps technicals in the short term. Staying on the sidelines.",
      score: 267,
      comments: 83,
      url: "https://mock.local/reddit/news_reversal/2",
      postedAt: new Date().toISOString(),
    },
  ],
  stale_quote: [
    {
      subreddit: "investing",
      title: "Having trouble getting current prices on {symbol} today",
      body: "Delayed data coming through on multiple platforms. Liquidity seems thin. Trading carefully until data feeds normalize. Not making decisions on stale prices.",
      score: 31,
      comments: 8,
      url: "https://mock.local/reddit/stale_quote/1",
      postedAt: new Date().toISOString(),
    },
  ],
  wide_spread: [
    {
      subreddit: "stocks",
      title: "{symbol} bid-ask spread is ridiculous right now — be careful",
      body: "Spread is over 2% on a normally liquid name. Market makers are stepping back. Do not market order into this. Use limit orders or wait for liquidity to return.",
      score: 156,
      comments: 37,
      url: "https://mock.local/reddit/wide_spread/1",
      postedAt: new Date().toISOString(),
    },
  ],
  partial_fill: [
    {
      subreddit: "stocks",
      title: "{symbol} momentum building — accumulation phase, thin supply",
      body: "Big buyers visible but fills are thin at current prices. Lots of interest, limited sellers. Good setup if you can get size; otherwise wait for liquidity to normalize.",
      score: 201,
      comments: 48,
      url: "https://mock.local/reddit/partial_fill/1",
      postedAt: new Date().toISOString(),
    },
    {
      subreddit: "investing",
      title: "{symbol} setting up for a move — watching order flow carefully",
      body: "Tape is constructive. Buyers absorbing supply methodically. Could take a few sessions to fully position. Patience required.",
      score: 134,
      comments: 31,
      url: "https://mock.local/reddit/partial_fill/2",
      postedAt: new Date().toISOString(),
    },
  ],
  broker_reject: [
    {
      subreddit: "stocks",
      title: "{symbol} looking like a solid entry at current levels",
      body: "Strong momentum, good relative strength, catalyst still driving. Setting alerts and watching for a clean entry. Risk management is key on this one.",
      score: 178,
      comments: 44,
      url: "https://mock.local/reddit/broker_reject/1",
      postedAt: new Date().toISOString(),
    },
  ],
  rate_limit: [
    {
      subreddit: "StockMarket",
      title: "{symbol} on watch — setup developing",
      body: "Early innings of a breakout. Watching for volume confirmation before adding. The structure is there; just needs follow-through.",
      score: 94,
      comments: 22,
      url: "https://mock.local/reddit/rate_limit/1",
      postedAt: new Date().toISOString(),
    },
  ],
};

export const SCENARIO_NEWS: Record<MockScenarioKind, NewsItem[]> = {
  clean_breakout: [
    {
      title:
        "{symbol} surges on record institutional inflows and momentum continuation",
      snippet:
        "Buyers extended their position in {symbol} as price broke above key resistance on strong volume, signaling continued follow-through demand from institutional players.",
      url: "https://mock.local/news/clean_breakout/1",
      publishedAt: new Date().toISOString(),
    },
    {
      title:
        "Analysts raise targets on {symbol} as technical structure improves post-breakout",
      snippet:
        "Three buy-side desks updated price targets for {symbol} following a clean breakout above the 52-week high with above-average volume and positive options flow.",
      url: "https://mock.local/news/clean_breakout/2",
      publishedAt: new Date().toISOString(),
    },
  ],
  failed_breakout: [
    {
      title:
        "{symbol} retreats sharply after failed test of resistance; sellers reassert control",
      snippet:
        "A breakout attempt in {symbol} failed to hold, with sellers quickly regaining control and pushing price back below prior support on above-average volume.",
      url: "https://mock.local/news/failed_breakout/1",
      publishedAt: new Date().toISOString(),
    },
    {
      title:
        "Momentum traders exiting {symbol} as breakout collapses below key level",
      snippet:
        "Stop-loss cascade accelerated the decline in {symbol} after the failed breakout, with selling pressure intensifying into the close and breadth deteriorating.",
      url: "https://mock.local/news/failed_breakout/2",
      publishedAt: new Date().toISOString(),
    },
  ],
  sideways_chop: [
    {
      title:
        "{symbol} holds narrow range as market awaits catalyst; volume below average",
      snippet:
        "No major moves in {symbol} this week. Volume is below the 20-day average and price action is consolidating within a tight range with no directional conviction.",
      url: "https://mock.local/news/sideways/1",
      publishedAt: new Date().toISOString(),
    },
  ],
  gap_down_after_entry: [
    {
      title:
        "{symbol} gaps down 9% after missing earnings estimates and slashing full-year guidance",
      snippet:
        "{symbol} reported Q3 EPS well below consensus while revenue missed significantly. Full-year guidance was cut by 22%. Shares fell sharply in after-hours trading.",
      url: "https://mock.local/news/gap_down/1",
      publishedAt: new Date().toISOString(),
    },
    {
      title:
        "Multiple analysts downgrade {symbol} following earnings disappointment and guidance reduction",
      snippet:
        "Sell-side desks cut ratings on {symbol} to Sell or Underperform following the earnings miss and sharply reduced revenue outlook for the coming quarters.",
      url: "https://mock.local/news/gap_down/2",
      publishedAt: new Date().toISOString(),
    },
  ],
  news_reversal: [
    {
      title:
        "{symbol} CEO resigns amid regulatory probe; full-year guidance slashed 30%",
      snippet:
        "Shares of {symbol} face sharp pressure after the sudden CEO departure and a major reduction in full-year guidance, directly contradicting recent technical strength.",
      url: "https://mock.local/news/news_reversal/1",
      publishedAt: new Date().toISOString(),
    },
    {
      title:
        "Despite bullish technicals, {symbol} fundamentals raise serious red flags for investors",
      snippet:
        "While {symbol} has built a constructive technical structure over recent weeks, the company disclosed material weaknesses in internal controls and an SEC inquiry.",
      url: "https://mock.local/news/news_reversal/2",
      publishedAt: new Date().toISOString(),
    },
  ],
  stale_quote: [
    {
      title:
        "Market data delays reported across multiple platforms; {symbol} quotes unreliable",
      snippet:
        "Data feed latency is causing delayed or missing quotes for {symbol} and other instruments this session. Traders advised to exercise caution and use limit orders only.",
      url: "https://mock.local/news/stale_quote/1",
      publishedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
  ],
  wide_spread: [
    {
      title:
        "{symbol} liquidity deteriorates; market makers widen spreads amid thin volume",
      snippet:
        "Bid-ask spreads in {symbol} have widened significantly as market makers reduce quote size. Execution costs are materially elevated and slippage risk is high.",
      url: "https://mock.local/news/wide_spread/1",
      publishedAt: new Date().toISOString(),
    },
  ],
  partial_fill: [
    {
      title:
        "{symbol} sees elevated demand at current prices as institutional buyers accumulate",
      snippet:
        "Strong buy-side interest in {symbol} at current levels, though order flow suggests limited available supply at the ask as sellers hold firm.",
      url: "https://mock.local/news/partial_fill/1",
      publishedAt: new Date().toISOString(),
    },
  ],
  broker_reject: [
    {
      title:
        "{symbol} showing continued strength on rising volume; breakout intact",
      snippet:
        "Technical momentum in {symbol} remains strong with price holding above key moving averages and volume confirming the recent move higher.",
      url: "https://mock.local/news/broker_reject/1",
      publishedAt: new Date().toISOString(),
    },
  ],
  rate_limit: [
    {
      title: "{symbol} remains in focus as breakout holds into the close",
      snippet:
        "Price action in {symbol} continues to track higher after the initial breakout, with the structure remaining intact and buyers defending intraday dips.",
      url: "https://mock.local/news/rate_limit/1",
      publishedAt: new Date().toISOString(),
    },
  ],
};

export const SCENARIO_TRENDING: Record<MockScenarioKind, TrendingSymbol[]> = {
  clean_breakout: [
    {
      symbol: "NVDA",
      name: "NVIDIA Corp",
      messageVolume: 3201,
      sentiment: "Bullish",
      watchlistCount: 2103441,
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices",
      messageVolume: 1821,
      sentiment: "Bullish",
      watchlistCount: 1241003,
    },
    {
      symbol: "PLTR",
      name: "Palantir Technologies",
      messageVolume: 1102,
      sentiment: "Bullish",
      watchlistCount: 612448,
    },
  ],
  failed_breakout: [
    {
      symbol: "AAPL",
      name: "Apple Inc",
      messageVolume: 1104,
      sentiment: "Bearish",
      watchlistCount: 2103441,
    },
    {
      symbol: "META",
      name: "Meta Platforms",
      messageVolume: 887,
      sentiment: "Bearish",
      watchlistCount: 987322,
    },
    {
      symbol: "NFLX",
      name: "Netflix Inc",
      messageVolume: 621,
      sentiment: "Neutral",
      watchlistCount: 701554,
    },
  ],
  sideways_chop: [
    {
      symbol: "SPY",
      name: "SPDR S&P 500 ETF",
      messageVolume: 3102,
      sentiment: "Neutral",
      watchlistCount: 4102884,
    },
    {
      symbol: "QQQ",
      name: "Invesco QQQ Trust",
      messageVolume: 2144,
      sentiment: "Neutral",
      watchlistCount: 2871003,
    },
    {
      symbol: "IWM",
      name: "iShares Russell 2000 ETF",
      messageVolume: 891,
      sentiment: "Neutral",
      watchlistCount: 1203445,
    },
  ],
  gap_down_after_entry: [
    {
      symbol: "AAPL",
      name: "Apple Inc",
      messageVolume: 4221,
      sentiment: "Bearish",
      watchlistCount: 2103441,
    },
    {
      symbol: "AMZN",
      name: "Amazon.com Inc",
      messageVolume: 2881,
      sentiment: "Bearish",
      watchlistCount: 1904332,
    },
    {
      symbol: "GOOGL",
      name: "Alphabet Inc",
      messageVolume: 1932,
      sentiment: "Bearish",
      watchlistCount: 1401223,
    },
  ],
  news_reversal: [
    {
      symbol: "TSLA",
      name: "Tesla Inc",
      messageVolume: 5102,
      sentiment: "Volatile",
      watchlistCount: 2801334,
    },
    {
      symbol: "META",
      name: "Meta Platforms",
      messageVolume: 3201,
      sentiment: "Mixed",
      watchlistCount: 987322,
    },
    {
      symbol: "AMZN",
      name: "Amazon.com Inc",
      messageVolume: 2103,
      sentiment: "Neutral",
      watchlistCount: 1904332,
    },
  ],
  stale_quote: [
    {
      symbol: "RIVN",
      name: "Rivian Automotive",
      messageVolume: 412,
      sentiment: "Neutral",
      watchlistCount: 312441,
    },
    {
      symbol: "LCID",
      name: "Lucid Group",
      messageVolume: 298,
      sentiment: "Neutral",
      watchlistCount: 241003,
    },
    {
      symbol: "SOFI",
      name: "SoFi Technologies",
      messageVolume: 201,
      sentiment: "Neutral",
      watchlistCount: 198332,
    },
  ],
  wide_spread: [
    {
      symbol: "RIVN",
      name: "Rivian Automotive",
      messageVolume: 311,
      sentiment: "Cautious",
      watchlistCount: 312441,
    },
    {
      symbol: "BBAI",
      name: "BigBear.ai Holdings",
      messageVolume: 187,
      sentiment: "Neutral",
      watchlistCount: 84223,
    },
    {
      symbol: "OPEN",
      name: "Opendoor Technologies",
      messageVolume: 143,
      sentiment: "Neutral",
      watchlistCount: 71009,
    },
  ],
  partial_fill: [
    {
      symbol: "GME",
      name: "GameStop Corp",
      messageVolume: 1892,
      sentiment: "Bullish",
      watchlistCount: 834102,
    },
    {
      symbol: "MSTR",
      name: "MicroStrategy Inc",
      messageVolume: 1541,
      sentiment: "Bullish",
      watchlistCount: 612448,
    },
    {
      symbol: "HOOD",
      name: "Robinhood Markets",
      messageVolume: 741,
      sentiment: "Bullish",
      watchlistCount: 321004,
    },
  ],
  broker_reject: [
    {
      symbol: "NVDA",
      name: "NVIDIA Corp",
      messageVolume: 3201,
      sentiment: "Bullish",
      watchlistCount: 2103441,
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices",
      messageVolume: 1821,
      sentiment: "Bullish",
      watchlistCount: 1241003,
    },
    {
      symbol: "AVGO",
      name: "Broadcom Inc",
      messageVolume: 892,
      sentiment: "Bullish",
      watchlistCount: 584002,
    },
  ],
  rate_limit: [
    {
      symbol: "NVDA",
      name: "NVIDIA Corp",
      messageVolume: 2891,
      sentiment: "Bullish",
      watchlistCount: 2103441,
    },
    {
      symbol: "PLTR",
      name: "Palantir Technologies",
      messageVolume: 1102,
      sentiment: "Bullish",
      watchlistCount: 612448,
    },
    {
      symbol: "TSLA",
      name: "Tesla Inc",
      messageVolume: 941,
      sentiment: "Neutral",
      watchlistCount: 2801334,
    },
  ],
};
