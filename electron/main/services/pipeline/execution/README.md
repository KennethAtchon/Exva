# pipeline/execution

Runs a single AI worker call: prompt build, tool assembly, LLM invoke, output validation.

## Technical

- `runAIWorker` in `worker-executor.ts`.
- `AISpendTracker` enforces phase/pipeline/session spend caps.
- `engine-prompt-injector.ts` injects signal engine results into prompts.
