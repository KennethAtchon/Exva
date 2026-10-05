// Local stand-ins for Alpaca and an OpenAI-compatible AI provider, plus a discrete-event clock.
import type { Clock } from "../src/core/clock.ts";

export interface Recorded {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/** A tiny HTTP server; `handler` returns [status, json]. Every request is recorded. */
export function fakeServer(
  handler: (r: Recorded) => [number, unknown] | Promise<[number, unknown]>,
) {
  const requests: Recorded[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const rec: Recorded = {
        method: req.method,
        path: url.pathname + url.search,
        headers: req.headers,
        body: text ? JSON.parse(text) : null,
      };
      requests.push(rec);
      const [status, json] = await handler(rec);
      return status === 204 ? new Response(null, { status }) : Response.json(json, { status });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

/** OpenAI-style chat completion body (usage fields as DeepSeek reports them; no cost field). */
export function completion(
  content: string | null,
  toolCalls?: unknown[],
  usage = {
    prompt_tokens: 1000,
    completion_tokens: 100,
    prompt_cache_hit_tokens: 200,
    prompt_cache_miss_tokens: 800,
  },
) {
  return {
    choices: [
      {
        message: { role: "assistant", content, tool_calls: toolCalls },
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
    usage,
  };
}

/**
 * Time only moves when the test says so. `runUntil` wakes sleepers in time order and lets the
 * async work they trigger settle before moving on, so live loops run deterministically.
 */
export class TestClock implements Clock {
  private timers: { at: number; resolve: () => void }[] = [];
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.t + Math.max(ms, 1), resolve }));
  }
  async runUntil(end: number): Promise<void> {
    await settle();
    while (true) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.resolve();
      await settle();
    }
    this.t = end;
  }
}

/** Everything in the engine resolves through microtasks here; setImmediate runs once they drain. */
async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}
