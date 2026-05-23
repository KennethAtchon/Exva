# tools

LLM-callable tool functions: market data, web fetch, search, Reddit, trending symbols.

## Technical

- Registered in `worker-tool-factory.ts` by tool id.
- Separate from `search/` — tools are the surface; search is provider infrastructure.
