// Alpaca Market Data: crypto (no keys needed) and US stocks (keys needed; IEX free or SIP paid).
import type { Bar, Timeframe } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import { DataError } from "../errors.ts";
import { errorMessage } from "../util.ts";

export interface BarProvider {
  readonly name: string;
  /** Bars whose start is in [from, to). May include the still-forming bar; the BarStore filters it out. */
  fetchBars(
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Map<string, Bar[]>>;
}

export interface AlpacaKeys {
  keyId: string;
  secretKey: string;
}

const ALPACA_TF: Record<Timeframe, string> = { "5m": "5Min", "15m": "15Min", "1h": "1Hour" };

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export class AlpacaData implements BarProvider {
  readonly name = "alpaca";

  constructor(
    private readonly opts: {
      keys: () => AlpacaKeys | null;
      stockFeed: () => "iex" | "sip";
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {}

  async fetchBars(
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Map<string, Bar[]>> {
    const out = new Map<string, Bar[]>();
    const crypto = symbols.filter((s) => assetClassOf(s) === "crypto");
    const stocks = symbols.filter((s) => assetClassOf(s) === "stock");
    if (crypto.length)
      await this.paged("/v1beta3/crypto/us/bars", crypto, timeframe, from, to, {}, out);
    if (stocks.length) {
      if (!this.opts.keys())
        throw new DataError("Stock data needs an Alpaca account. Add your paper keys in Settings.");
      const extra = { feed: this.opts.stockFeed(), adjustment: "raw" };
      await this.paged("/v2/stocks/bars", stocks, timeframe, from, to, extra, out);
    }
    return out;
  }

  private async paged(
    path: string,
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
    extra: Record<string, string>,
    out: Map<string, Bar[]>,
  ): Promise<void> {
    const base = this.opts.baseUrl ?? "https://data.alpaca.markets";
    const keys = this.opts.keys();
    const headers: Record<string, string> = keys
      ? { "APCA-API-KEY-ID": keys.keyId, "APCA-API-SECRET-KEY": keys.secretKey }
      : {};
    let pageToken: string | null = null;
    for (let page = 0; page < 500; page++) {
      const q = new URLSearchParams({
        symbols: symbols.join(","),
        timeframe: ALPACA_TF[timeframe],
        start: new Date(from).toISOString(),
        end: new Date(to - 1).toISOString(),
        limit: "10000",
        sort: "asc",
        ...extra,
      });
      if (pageToken) q.set("page_token", pageToken);
      let res: Response;
      try {
        res = await (this.opts.fetch ?? fetch)(`${base}${path}?${q}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new DataError(`Could not reach Alpaca market data: ${errorMessage(err)}`);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        throw new DataError(`Alpaca market data returned ${res.status}: ${body}`);
      }
      const body = (await res.json()) as {
        bars: Record<string, RawBar[]> | null;
        next_page_token?: string | null;
      };
      for (const [symbol, bars] of Object.entries(body.bars ?? {})) {
        const list = out.get(symbol) ?? [];
        for (const b of bars)
          list.push({ ts: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
        out.set(symbol, list);
      }
      pageToken = body.next_page_token ?? null;
      if (!pageToken) return;
    }
  }
}
