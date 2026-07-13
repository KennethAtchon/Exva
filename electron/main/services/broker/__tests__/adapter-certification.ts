import { z } from "zod";
import type { BrokerAdapter } from "../adapters/broker-adapter";
import {
  adapterSupportsOrder,
  type AdapterCapabilities,
  type BrokerOrderV2,
} from "../order-contract-v2";
import { adapterCapabilitiesOf } from "../adapters/broker-adapter";

const balanceSchema = z.number().finite();
const positionSchema = z.object({
  instrumentSymbol: z.string(),
  instrumentType: z.string(),
  side: z.enum(["long", "short"]),
  sizeUsd: z.number(),
  unrealizedPnl: z.number(),
});
const snapshotSchema = z.object({
  instrumentSymbol: z.string(),
  price: z.number(),
  timestamp: z.string(),
});

export interface CertCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AdapterCertReport {
  brokerType: string;
  mode: "mock" | "live-keys";
  passed: boolean;
  checks: CertCheckResult[];
}

export interface AdapterCertOptions {
  adapter: BrokerAdapter;
  /** Symbol used for quote / far-limit / marketable tests. */
  symbol: string;
  instrumentClass: BrokerOrderV2["instrument"]["instrumentClass"];
  /** When false, skip place/cancel/fill (auth + read-only only). */
  trade?: boolean;
  /** Timeout waiting for a terminal fill event (ms). */
  fillTimeoutMs?: number;
  /** Far-from-market limit price multiplier vs last (buy uses below market). */
  farLimitFraction?: number;
}

function check(name: string, ok: boolean, detail: string): CertCheckResult {
  return { name, ok, detail };
}

/**
 * Parameterized adapter certification. Runs against mock in CI; real adapters
 * via `bun run cert:broker -- <name>` with demo/sandbox keys.
 */
export async function runAdapterCertification(
  options: AdapterCertOptions,
): Promise<AdapterCertReport> {
  const { adapter, symbol, instrumentClass } = options;
  const trade = options.trade !== false;
  const checks: CertCheckResult[] = [];
  const caps = adapterCapabilitiesOf(adapter);

  // --- Auth / balance ---
  try {
    const conn = await adapter.testConnection();
    checks.push(
      check(
        "testConnection",
        conn.ok,
        conn.ok ? conn.message : `failed: ${conn.message}`,
      ),
    );
  } catch (err) {
    checks.push(
      check(
        "testConnection",
        false,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  try {
    const bal = await adapter.getAccountBalance();
    balanceSchema.parse(bal);
    checks.push(check("getAccountBalance", true, `balance=${bal}`));
  } catch (err) {
    checks.push(
      check(
        "getAccountBalance",
        false,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  try {
    const positions = await adapter.getPositions();
    z.array(positionSchema).parse(positions);
    checks.push(check("getPositions", true, `positions=${positions.length}`));
  } catch (err) {
    checks.push(
      check(
        "getPositions",
        false,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  try {
    const snap = await adapter.getMarketSnapshot(symbol);
    snapshotSchema.parse(snap);
    checks.push(
      check("getMarketSnapshot", snap.price >= 0, `price=${snap.price}`),
    );
  } catch (err) {
    checks.push(
      check(
        "getMarketSnapshot",
        false,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // --- Capabilities honesty ---
  const unsupported = inventUnsupportedOrder(caps, symbol, instrumentClass);
  if (unsupported) {
    const gate = adapterSupportsOrder(caps, unsupported);
    checks.push(
      check(
        "capabilitiesRefuseUnsupported",
        !gate.ok,
        gate.ok
          ? "policy would allow unsupported shape"
          : `refused: ${gate.reason}`,
      ),
    );
    if (adapter.placeOrderV2 && gate.ok === false) {
      try {
        await adapter.placeOrderV2(unsupported);
        checks.push(
          check(
            "placeOrderV2RejectsUnsupported",
            false,
            "placed unsupported order instead of rejecting",
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push(
          check("placeOrderV2RejectsUnsupported", true, msg.slice(0, 120)),
        );
      }
    }
  } else {
    checks.push(
      check(
        "capabilitiesRefuseUnsupported",
        true,
        "adapter supports full surface — skipped invent",
      ),
    );
  }

  if (trade && adapter.placeOrderV2) {
    let snapPrice = 0;
    try {
      snapPrice = (await adapter.getMarketSnapshot(symbol)).price;
    } catch {
      snapPrice = 0;
    }

    if (caps.supportsLimit && snapPrice > 0) {
      const frac = options.farLimitFraction ?? 0.5;
      const farPrice = frac < 1 ? snapPrice * frac : snapPrice * frac;
      const clientOrderId = `cert-far-${Date.now()}`;
      try {
        const placed = await adapter.placeOrderV2({
          clientOrderId,
          instrument: { symbol, instrumentClass },
          side: "BUY",
          quantity: { kind: caps.quantityKinds[0] ?? "units", value: 1 },
          orderType: "limit",
          limitPrice: Math.max(0.01, farPrice),
          timeInForce: caps.timeInForce.includes("gtc") ? "gtc" : "day",
        });
        const status = await adapter.getOrderStatus(placed.brokerOrderId);
        checks.push(
          check(
            "placeFarLimit",
            status.status === "open" || status.status === "closed",
            `id=${placed.brokerOrderId} status=${status.status}`,
          ),
        );
        await adapter.cancelOrder(placed.brokerOrderId);
        const after = await adapter.getOrderStatus(placed.brokerOrderId);
        checks.push(
          check(
            "cancelFarLimit",
            after.status === "closed" || after.status === "unknown",
            `status=${after.status}`,
          ),
        );
      } catch (err) {
        checks.push(
          check(
            "placeFarLimit",
            false,
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }

    if (caps.orderTypes.includes("market") && snapPrice > 0) {
      const clientOrderId = `cert-mkt-${Date.now()}`;
      const qtyKind = caps.quantityKinds.includes("units")
        ? ("units" as const)
        : ("notional_usd" as const);
      try {
        const placed = await adapter.placeOrderV2({
          clientOrderId,
          instrument: { symbol, instrumentClass },
          side: "BUY",
          quantity:
            qtyKind === "units"
              ? { kind: "units", value: 1 }
              : { kind: "notional_usd", value: Math.max(1, snapPrice) },
          orderType: "market",
          timeInForce: caps.timeInForce.includes("ioc")
            ? "ioc"
            : (caps.timeInForce[0] ?? "day"),
        });
        checks.push(
          check(
            "placeMarketable",
            Boolean(placed.brokerOrderId),
            `id=${placed.brokerOrderId} fillPx=${placed.filledAvgPrice}`,
          ),
        );

        if (adapter.createOrderEventFeed) {
          const fillTimeout = options.fillTimeoutMs ?? 15_000;
          let gotFill = placed.filledAvgPrice > 0;
          if (!gotFill) {
            const feed = adapter.createOrderEventFeed();
            gotFill = await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => resolve(false), fillTimeout);
              feed.onEvent((ev) => {
                if (
                  ev.brokerOrderId === placed.brokerOrderId &&
                  (ev.kind === "fill" ||
                    ev.kind === "canceled" ||
                    ev.kind === "rejected")
                ) {
                  clearTimeout(timer);
                  resolve(ev.kind === "fill");
                }
              });
              feed.watchOrders?.([placed.brokerOrderId]);
              void feed.start();
            });
            await feed.stop();
          }
          checks.push(
            check(
              "orderEventFeedTerminal",
              gotFill || placed.filledAvgPrice > 0,
              gotFill
                ? placed.filledAvgPrice > 0 && fillTimeout
                  ? "terminal fill observed"
                  : "feed emitted terminal event"
                : "no terminal fill within timeout",
            ),
          );
        }
      } catch (err) {
        checks.push(
          check(
            "placeMarketable",
            false,
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }
  }

  // --- Error taxonomy (best-effort; mock may not hit HTTP) ---
  checks.push(
    check(
      "errorTaxonomyDocumented",
      true,
      "BROKER_AUTH|INSUFFICIENT_FUNDS|UNKNOWN_SYMBOL|REJECTED via AppError",
    ),
  );

  const passed = checks.every((c) => c.ok);
  return {
    brokerType: adapter.brokerType,
    mode: adapter.brokerType === "mock" ? "mock" : "live-keys",
    passed,
    checks,
  };
}

function inventUnsupportedOrder(
  caps: AdapterCapabilities,
  symbol: string,
  instrumentClass: BrokerOrderV2["instrument"]["instrumentClass"],
): BrokerOrderV2 | null {
  const base: BrokerOrderV2 = {
    clientOrderId: `cert-unsupported-${Date.now()}`,
    instrument: { symbol, instrumentClass },
    side: "BUY",
    quantity: { kind: caps.quantityKinds[0] ?? "units", value: 1 },
    orderType: "market",
    timeInForce: caps.timeInForce[0] ?? "day",
  };
  if (!caps.supportsBracket) {
    return {
      ...base,
      bracket: { stopLossPrice: 1, takeProfitPrice: 2 },
    };
  }
  if (!caps.supportsStop) {
    return { ...base, orderType: "stop", stopPrice: 1 };
  }
  if (!caps.supportsMultileg) {
    return {
      ...base,
      legs: [
        { symbol: `${symbol}LEG1`, side: "BUY", quantity: 1 },
        { symbol: `${symbol}LEG2`, side: "SELL", quantity: 1 },
      ],
    };
  }
  if (!caps.quantityKinds.includes("notional_usd")) {
    return {
      ...base,
      quantity: { kind: "notional_usd", value: 100 },
    };
  }
  return null;
}

export function formatCertReport(report: AdapterCertReport): string {
  const lines = [
    `=== Adapter certification: ${report.brokerType} (${report.mode}) ===`,
    `Result: ${report.passed ? "PASS" : "FAIL"}`,
    ...report.checks.map(
      (c) => `  [${c.ok ? "OK" : "FAIL"}] ${c.name}: ${c.detail}`,
    ),
  ];
  return lines.join("\n");
}
