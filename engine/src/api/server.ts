// Local HTTP + WebSocket API. Bound to 127.0.0.1, every request needs the engine's token, and the
// Host header is checked so web pages (including DNS-rebinding tricks) cannot drive the engine.
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  accountInputSchema,
  assistantInputSchema,
  backtestInputSchema,
  botInputSchema,
  botPatchSchema,
  explainInputSchema,
  killSwitchSchema,
  settingsPatchSchema,
} from "@shared/schemas.ts";
import type { DecisionKind, Timeframe, WsMessage } from "@shared/types.ts";
import { TIMEFRAME_MS } from "@shared/types.ts";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import { assistant, explain, latestJournal, writeJournal } from "../ai/insights.ts";
import type { Engine } from "../engine.ts";
import { InputError } from "../errors.ts";
import { STRATEGIES, strategyInfo } from "../strategies/index.ts";
import { errorMessage } from "../util.ts";

type Req = Request & { params: Record<string, string> };
type Handler = (req: Req, url: URL) => unknown | Promise<unknown>;

const DAY = 86_400_000;

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError("Request body is not valid JSON");
  }
  const res = schema.safeParse(raw);
  if (!res.success) throw new InputError(z.prettifyError(res.error));
  return res.data;
}

const num = (url: URL, key: string, fallback: number) => {
  const v = url.searchParams.get(key);
  return v === null || v === "" ? fallback : Number(v);
};

export function routes(
  engine: Engine,
): Record<string, Partial<Record<"GET" | "POST" | "PATCH" | "PUT" | "DELETE", Handler>>> {
  return {
    "/api/status": { GET: () => engine.status() },
    "/api/accounts": {
      GET: () => engine.listAccounts(),
      POST: async (req) => engine.saveAccount(await body(req, accountInputSchema)),
    },
    "/api/accounts/:id/test": { POST: (req) => engine.testAccount(req.params.id as string) },
    "/api/strategies": { GET: () => STRATEGIES.map(strategyInfo) },
    "/api/bots": {
      GET: () => engine.listBots(),
      POST: async (req) => engine.createBot(await body(req, botInputSchema)),
    },
    "/api/bots/:id": {
      GET: (req) => ({
        bot: engine.getBot(req.params.id as string),
        warnings: engine.botWarnings(engine.getBot(req.params.id as string)),
      }),
      PATCH: async (req) =>
        engine.updateBot(req.params.id as string, await body(req, botPatchSchema)),
      DELETE: (req) => {
        engine.deleteBot(req.params.id as string);
        return { ok: true };
      },
    },
    "/api/bots/:id/start": { POST: (req) => engine.startBot(req.params.id as string) },
    "/api/bots/:id/stop": {
      POST: async (req) =>
        engine.stopBot(
          req.params.id as string,
          (await body(req, z.object({ closePositions: z.boolean().default(false) })))
            .closePositions,
        ),
    },
    "/api/bots/:id/decisions": {
      GET: (req, url) => {
        const kinds = url.searchParams.get("kinds")?.split(",").filter(Boolean) as
          | DecisionKind[]
          | undefined;
        return engine.store.listDecisions(req.params.id as string, {
          symbol: url.searchParams.get("symbol") || undefined,
          kinds,
          before: url.searchParams.has("before") ? num(url, "before", 0) : undefined,
          limit: Math.min(num(url, "limit", 100), 1000),
        });
      },
    },
    "/api/bots/:id/summary": { GET: (req) => engine.summary(req.params.id as string) },
    "/api/chart": {
      GET: (_req, url) => {
        const tf = (url.searchParams.get("timeframe") ?? "15m") as Timeframe;
        if (!TIMEFRAME_MS[tf]) throw new InputError("Unknown timeframe");
        const to = num(url, "to", engine.clock.now());
        const from = num(url, "from", to - 300 * TIMEFRAME_MS[tf]);
        const symbol = url.searchParams.get("symbol");
        if (!symbol) throw new InputError("symbol is required");
        return engine.chart(symbol, tf, from, to, url.searchParams.get("bot") || undefined);
      },
    },
    "/api/orders": {
      GET: (_req, url) =>
        engine.store.listOrders({
          botId: url.searchParams.get("bot") || undefined,
          limit: Math.min(num(url, "limit", 200), 2000),
        }),
    },
    "/api/trades": {
      GET: (_req, url) => {
        const status = url.searchParams.get("status") as "open" | "closed" | null;
        return engine.withMarks(
          engine.store.listTrades({
            botId: url.searchParams.get("bot") || undefined,
            status: status ?? undefined,
            since: url.searchParams.has("since") ? num(url, "since", 0) : undefined,
            limit: Math.min(num(url, "limit", 500), 5000),
          }),
        );
      },
    },
    "/api/equity": {
      GET: (_req, url) => {
        const to = num(url, "to", engine.clock.now());
        return engine.equity(
          url.searchParams.get("account") || undefined,
          num(url, "from", to - 30 * DAY),
          to,
        );
      },
    },
    "/api/events": {
      GET: (_req, url) =>
        engine.store.listEvents({
          kind: url.searchParams.get("kind") || undefined,
          limit: Math.min(num(url, "limit", 50), 500),
        }),
    },
    "/api/backtests": {
      GET: () => engine.store.listBacktests(),
      POST: async (req) => ({ id: engine.startBacktest(await body(req, backtestInputSchema)) }),
    },
    "/api/backtests/:id": {
      GET: (req) => {
        const bt = engine.store.getBacktest(req.params.id as string);
        if (!bt) throw new InputError("Unknown backtest");
        return bt;
      },
    },
    "/api/preview": {
      POST: async (req) => {
        const input = await body(req, backtestInputSchema);
        const bt = await engine.backtest(engine.backtestSpec({ ...input, aiMaxCalls: 0 }));
        return { metrics: bt.metrics, equity: bt.equity, decisionCounts: bt.decisionCounts };
      },
    },
    "/api/settings": {
      GET: () => engine.settings.get(),
      PUT: async (req) => engine.settings.patch(await body(req, settingsPatchSchema)),
    },
    "/api/kill-switch": {
      POST: async (req) => {
        engine.setKillSwitch((await body(req, killSwitchSchema)).on);
        return engine.status();
      },
    },
    "/api/journal": {
      GET: () => latestJournal(engine),
      POST: () => writeJournal(engine),
    },
    "/api/explain": {
      POST: async (req) => ({ text: await explain(engine, await body(req, explainInputSchema)) }),
    },
    "/api/assistant": {
      POST: async (req) => assistant(engine, (await body(req, assistantInputSchema)).messages),
    },
  };
}

export interface ApiOptions {
  port: number;
  token: string;
  uiDir?: string;
}

/** Wrap a handler with auth, host checks and JSON error handling. */
function guard(opts: ApiOptions, handler: Handler): (req: Req) => Promise<Response> {
  return async (req) => {
    const denied = deny(req, opts);
    if (denied) return denied;
    try {
      const out = await handler(req, new URL(req.url));
      return Response.json(out ?? null);
    } catch (err) {
      const status = err instanceof InputError ? 400 : 500;
      if (status === 500) console.error(err);
      return Response.json({ error: errorMessage(err) }, { status });
    }
  };
}

function deny(req: Request, opts: ApiOptions): Response | null {
  const host = req.headers.get("host") ?? "";
  if (host !== `127.0.0.1:${opts.port}` && host !== `localhost:${opts.port}`)
    return new Response("Forbidden host", { status: 403 });
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? `Bearer ${url.searchParams.get("token") ?? ""}`;
  if (auth !== `Bearer ${opts.token}`)
    return Response.json({ error: "Missing or wrong engine token" }, { status: 401 });
  return null;
}

/** Serves the built UI with the token injected, so the desktop window (or any local browser tab) can call the API. */
function serveUi(req: Request, opts: ApiOptions): Response {
  const host = req.headers.get("host") ?? "";
  if (host !== `127.0.0.1:${opts.port}` && host !== `localhost:${opts.port}`)
    return new Response("Forbidden host", { status: 403 });
  const dir = opts.uiDir;
  if (!dir || !existsSync(join(dir, "index.html"))) {
    return new Response("Exva engine is running. Build the UI with `bun run build:ui`.", {
      status: 200,
    });
  }
  const path = normalize(new URL(req.url).pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(dir, path);
  if (path !== "/" && file.startsWith(dir) && existsSync(file) && !file.endsWith("/"))
    return new Response(Bun.file(file));
  const html = readFileSync(join(dir, "index.html"), "utf8").replace(
    "</head>",
    `<script>window.__EXVA__=${JSON.stringify({ token: opts.token })}</script></head>`,
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function startApi(engine: Engine, opts: ApiOptions): Server<undefined> {
  const table: Record<string, Partial<Record<string, (req: Req) => Promise<Response>>>> = {};
  for (const [path, methods] of Object.entries(routes(engine))) {
    table[path] = Object.fromEntries(
      Object.entries(methods).map(([m, h]) => [m, guard(opts, h as Handler)]),
    );
  }
  const sockets = new Set<ServerWebSocket<undefined>>();
  engine.events.subscribe((msg: WsMessage) => {
    const text = JSON.stringify(msg);
    for (const ws of sockets) ws.send(text);
  });
  return Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    // biome-ignore lint/suspicious/noExplicitAny: Bun's route typing does not model our param-carrying handlers
    routes: table as any,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/api/ws") {
        const denied = deny(req, opts);
        if (denied) return denied;
        return server.upgrade(req) ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      if (url.pathname.startsWith("/api/"))
        return Response.json({ error: "Not found" }, { status: 404 });
      return serveUi(req, opts);
    },
    websocket: {
      open: (ws) => {
        sockets.add(ws);
      },
      close: (ws) => {
        sockets.delete(ws);
      },
      message: () => {},
    },
  });
}
