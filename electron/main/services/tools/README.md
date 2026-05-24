# tools

This folder contains the callable functions an AI worker is allowed to use while it reasons about markets. The files here are the tool surface exposed to the model: quotes, OHLCV, news, web search, URL fetching, Reddit discovery, and trending retail-symbol discovery.

## How it works

- Tools are created as AI SDK `tool(...)` objects with Zod input schemas and async `execute` functions. The pipeline assembles them through `pipeline/worker-tools/worker-tool-factory.ts` based on worker configuration and session context.
- `market-tools.ts` builds `get_quote`, `get_ohlcv`, and `get_news` when enabled. Quote and OHLCV calls route through the configured broker for the instrument class, normalize symbols for broker-specific formats, and return structured market snapshots or synthetic bars.
- `get_news` either returns scenario-specific mock news or searches the configured search provider for `<symbol> latest market news`. This keeps news lookup behind the same search-provider infrastructure as `search_web`.
- `search-tool.ts` builds `search_web`. In live mode it resolves the configured `SearchAdapter`, validates and sanitizes the query, checks the session data-spend cap, logs the API call, and optionally falls back to a secondary provider. In mock mode it searches deterministic fixture data and logs a cached mock call.
- `fetch-url-tool.ts` builds `fetch_url`. It reads external text after search, strips HTML, caps content at 8,000 characters, logs fetch calls, supports mock fixture pages, and treats returned content as untrusted evidence.
- `fetch_url` has explicit SSRF protections: it only allows HTTP/HTTPS, blocks loopback/private hostnames and IP ranges, resolves DNS before fetching, manually follows redirects, and re-validates every redirect target before following it.
- `search-reddit-tool.ts` builds `search_reddit`. It validates discovery queries, selects default stock/investing subreddits plus crypto subreddits when crypto is enabled, supports mock posts, and currently blocks live Reddit search unless OAuth/authenticated support is provided.
- `trending-symbols-tool.ts` builds `get_trending_symbols`. It reads StockTwits trending symbols with a short timeout or returns mock trending symbols, then logs the call as a retail-sentiment discovery signal.
- Every live data tool logs to `ApiCallLogRepo` with provider, endpoint, call type, credits/cost when known, latency, status, cache flag, session id, cycle id, and optional trade id. These logs are used for auditing spend and behavior.
- Tool functions are deliberately defensive. They usually return `{ error: string }` to the model for recoverable tool failures instead of throwing, so the worker can explain missing evidence or choose a different path.

## Flow

```mermaid
flowchart TD
    Factory[pipeline/worker-tools/worker-tool-factory] --> Config[Worker tool config]
    Config --> Market[market-tools]
    Config --> Search[search-tool]
    Config --> Fetch[fetch-url-tool]
    Config --> Reddit[search-reddit-tool]
    Config --> Trending[trending-symbols-tool]

    Market --> Broker[BrokerRegistry / broker adapters]
    Market --> NewsSearch[SearchRegistry for get_news]
    Search --> SearchRegistry[SearchRegistry]
    Fetch --> Web[External URL fetch with SSRF guard]
    Reddit --> RedditAPI[Reddit API or mock posts]
    Trending --> StockTwits[StockTwits API or mock symbols]

    Broker --> Log[ApiCallLogRepo where applicable]
    NewsSearch --> Log
    SearchRegistry --> Log
    Web --> Log
    RedditAPI --> Log
    StockTwits --> Log
```

## Terms

- **Tool** - AI SDK callable function exposed to a model during a worker run.
- **Tool id** - Name the model calls, such as `search_web`, `fetch_url`, `get_quote`, `get_ohlcv`, `get_news`, `search_reddit`, or `get_trending_symbols`.
- **Worker tool factory** - Pipeline code that decides which tools a specific worker receives for a run.
- **Mock session** - Sandbox mode where tools use deterministic fixtures instead of live network/broker data.
- **Data spend cap** - Session-level guard checked before paid/search/fetch style data calls.
- **SSRF guard** - Fetch policy that blocks local, private, loopback, non-HTTP, and unsafe redirect targets.
- **Untrusted evidence** - External content returned by search/fetch/Reddit tools. Workers may extract facts from it but must ignore embedded instructions.
