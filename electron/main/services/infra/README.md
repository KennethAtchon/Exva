# infra

Infrastructure primitives — structured logging, event bus, notifications, secrets/keychain access.

## Technical

- `event-bus.ts` fans out allowlisted events to renderer windows.
- `secrets-service.ts` reads credentials from OS keychain.
