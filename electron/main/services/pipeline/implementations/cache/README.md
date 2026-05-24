# pipeline/implementations/cache

Keeps selector cache policy logic in one place. This is where the pipeline decides when a previous selector result is still safe to reuse and when it must be recomputed.

## Technical

- `selector-instrument-cache.ts` is the current cache-policy implementation.
- The cache uses selector output plus a definition fingerprint so stale logic does not silently survive code changes.

## Terms

- **Cache policy** — rules for reading, invalidating, and writing cached selector results.
