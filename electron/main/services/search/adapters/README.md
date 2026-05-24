# search/adapters

Implements the concrete web-search backends behind Exva's `search_web` tool. The rest of the app asks for search results through one interface; these files handle the provider-specific HTTP details.

## Technical

- `search-adapter.ts` defines the shared adapter contract.
- Each provider file maps Exva's normalized query/result shape to one external search backend.
- Adapter choice is resolved by `search/search-registry.ts`.

## Terms

- **Search adapter** — provider-specific implementation of the shared search contract.
