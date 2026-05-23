# llm

Talks to LLM providers — one call at a time with retries, streaming, cost tracking, and tool-loop guards.

## Technical

- `LLMRuntime` is the main entry; `PipelineRuntime` delegates worker runs here.
- `adapters/` normalize Anthropic, OpenAI, and OpenRouter request/response shapes.
- `llm-types.ts` defines `LLMMessage`, `LLMCallTrace`, `LLMRunResult`.

## Terms

- **LLMCallTrace** — full record of one model invocation including tool steps.
