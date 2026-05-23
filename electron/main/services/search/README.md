# search

Web search provider abstraction. Workers call `search_web`; this picks Brave, Tavily, DuckDuckGo, or MCP.

## Technical

- `search-registry.ts` resolves provider account → adapter.
- `adapters/` implement the common search interface.
