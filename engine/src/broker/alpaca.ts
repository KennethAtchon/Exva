// Alpaca Trading API (paper in v2.0). Orders are polled; the client_order_id makes every submit idempotent.
import type { OrderStatus } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import { etToEpoch, type Session } from "../core/calendar.ts";
import type { AlpacaKeys } from "../data/alpaca-data.ts";
import { BrokerRejected, BrokerUnavailable } from "../errors.ts";
import { errorMessage } from "../util.ts";
import type { Broker, BrokerAccount, BrokerOrder, BrokerPosition, OrderRequest } from "./types.ts";

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets";

// Alpaca charges crypto fees but doesn't report them on the order. Buys pay in coin (the position is
// smaller than the fill, which the exit's sell size absorbs); sells pay in dollars, estimated here at
// the entry-tier taker rate.
const CRYPTO_SELL_FEE = 0.0025;

interface RawOrder {
  id: string;
  client_order_id: string;
  symbol?: string;
  side?: string;
  asset_class?: string;
  status: string;
  filled_qty: string | null;
  filled_avg_price: string | null;
  filled_at: string | null;
  updated_at: string | null;
}

export function mapAlpacaStatus(status: string): OrderStatus {
  switch (status) {
    case "filled":
      return "filled";
    case "partially_filled":
      return "partially_filled";
    case "canceled":
      return "canceled";
    case "expired":
      return "expired";
    case "rejected":
      return "rejected";
    default:
      return "submitted"; // new, accepted, pending_new, held, done_for_day (resumes), pending_cancel, ...
  }
}

function mapOrder(o: RawOrder): BrokerOrder {
  const filledQty = Number(o.filled_qty ?? 0);
  const avgFillPrice = o.filled_avg_price ? Number(o.filled_avg_price) : null;
  const crypto = o.asset_class === "crypto" || assetClassOf(o.symbol ?? "") === "crypto";
  const cryptoSell = o.side === "sell" && crypto;
  return {
    brokerOrderId: o.id,
    clientOrderId: o.client_order_id,
    status: mapAlpacaStatus(o.status),
    filledQty,
    avgFillPrice,
    fee: cryptoSell && avgFillPrice ? filledQty * avgFillPrice * CRYPTO_SELL_FEE : undefined,
    filledAt: o.filled_at
      ? Date.parse(o.filled_at)
      : o.updated_at
        ? Date.parse(o.updated_at)
        : undefined,
  };
}

const qtyString = (q: number) => q.toFixed(9).replace(/\.?0+$/, "");

export class AlpacaBroker implements Broker {
  readonly kind = "alpaca" as const;

  constructor(private readonly o: { keys: AlpacaKeys; baseUrl?: string; fetch?: typeof fetch }) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<T | null> {
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(`${this.o.baseUrl ?? ALPACA_PAPER_URL}${path}`, {
        method,
        headers: {
          "APCA-API-KEY-ID": this.o.keys.keyId,
          "APCA-API-SECRET-KEY": this.o.keys.secretKey,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new BrokerUnavailable(`Could not reach Alpaca: ${errorMessage(err)}`);
    }
    if (res.status === 404 && allow404) return null;
    if (res.status === 429 || res.status >= 500)
      throw new BrokerUnavailable(`Alpaca returned ${res.status}`);
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {}
      throw new BrokerRejected(`Alpaca: ${message}`.slice(0, 300));
    }
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  async account(): Promise<BrokerAccount> {
    const a = await this.request<Record<string, string>>("GET", "/v2/account");
    if (!a) throw new BrokerUnavailable("Empty account response");
    return {
      equity: Number(a.equity),
      cash: Number(a.cash),
      buyingPower: Number(a.non_marginable_buying_power ?? a.buying_power),
      mode: "paper",
    };
  }

  async submit(req: OrderRequest): Promise<BrokerOrder> {
    const body: Record<string, string> = {
      symbol: req.symbol,
      side: req.side,
      type: "market",
      time_in_force: assetClassOf(req.symbol) === "crypto" ? "gtc" : "day",
      client_order_id: req.clientOrderId,
    };
    if (req.notional !== undefined) body.notional = req.notional.toFixed(2);
    else body.qty = qtyString(req.qty ?? 0);
    const raw = await this.request<RawOrder>("POST", "/v2/orders", body);
    if (!raw) throw new BrokerUnavailable("Empty order response");
    return mapOrder(raw);
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder | null> {
    const raw = await this.request<RawOrder>(
      "GET",
      `/v2/orders/${encodeURIComponent(brokerOrderId)}`,
      undefined,
      true,
    );
    return raw ? mapOrder(raw) : null;
  }

  async getByClientId(clientOrderId: string): Promise<BrokerOrder | null> {
    const q = new URLSearchParams({ client_order_id: clientOrderId });
    const raw = await this.request<RawOrder>(
      "GET",
      `/v2/orders:by_client_order_id?${q}`,
      undefined,
      true,
    );
    return raw ? mapOrder(raw) : null;
  }

  async cancel(brokerOrderId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/v2/orders/${encodeURIComponent(brokerOrderId)}`,
      undefined,
      true,
    );
  }

  async positions(): Promise<BrokerPosition[]> {
    const raw = (await this.request<Record<string, string>[]>("GET", "/v2/positions")) ?? [];
    return raw.map((p) => ({
      symbol:
        p.asset_class === "crypto" && !(p.symbol ?? "").includes("/")
          ? (p.symbol ?? "").replace(/(USD|USDT|USDC|BTC)$/, "/$1")
          : (p.symbol ?? ""),
      qty: Number(p.qty),
      avgPrice: Number(p.avg_entry_price),
    }));
  }

  async calendar(fromKey: string, toKey: string): Promise<Session[]> {
    const q = new URLSearchParams({ start: fromKey, end: toKey });
    const raw =
      (await this.request<{ date: string; open: string; close: string }[]>(
        "GET",
        `/v2/calendar?${q}`,
      )) ?? [];
    return raw.map((d) => {
      const [y, m, day] = d.date.split("-").map(Number) as [number, number, number];
      const [oh, om] = d.open.split(":").map(Number) as [number, number];
      const [ch, cm] = d.close.split(":").map(Number) as [number, number];
      return {
        date: d.date,
        open: etToEpoch(y, m, day, oh, om),
        close: etToEpoch(y, m, day, ch, cm),
      };
    });
  }
}
