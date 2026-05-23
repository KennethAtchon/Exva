# pipeline/prompting

Builds worker prompts from strategy context, presets, and task payloads.

## Technical

- `buildWorkerPrompt` returns `LLMMessage[]` ready for the provider adapter.
- `strategy-guidance.ts` derives preset behavior text from session config.
