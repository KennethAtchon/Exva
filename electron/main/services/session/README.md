# session

Session CRUD, runtime lifecycle, strategy context resolution, preflight checks, environment mode.

## Technical

- `SessionRuntimeManager` owns live `SessionRuntime` instances.
- `environment-scope.ts` resolves live/paper/mock mode.
