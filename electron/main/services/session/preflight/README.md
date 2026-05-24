# session/preflight

Runs the checks that must pass before a session can start. This folder is the guardrail layer that catches missing credentials, broker mismatches, selector misconfiguration, and other startup blockers early.

## Technical

- Each file is one focused preflight check.
- `index.ts` assembles the checks into the startup flow used by session runtime management.
- Checks return structured failures so the UI and runtime can surface the real reason a session cannot launch.

## Terms

- **Preflight check** — validation that must pass before a session runtime is allowed to start.
