The session creation modal and backend write-service have been updated to support multi-select signal sources per session.

Changes made (2026-06-16):

- `electron/main/services/session/write-service.ts`: Removed the `size > 1` validation that blocked subscribing to multiple signal sources.
- `src/components/sessions/CreateEditSessionModal.tsx`:
  - Toggle handler now adds/removes individual sources from the array (was: replace entire array with single item).
  - Experience-change handler now pre-selects all compatible+enabled sources (was: single preferred source). Exception: mock-rehearsal still selects only the mock source.
  - New-session init now selects all enabled edgar_8k sources (was: one via stale `experienceSignalSourceId` lookup with `.slice(0,1)`).

Both `bun run typecheck` and the session-input-model unit tests pass.
