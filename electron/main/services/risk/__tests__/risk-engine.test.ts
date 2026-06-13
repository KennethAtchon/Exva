import { describe, expect, it } from "vitest";
import type { DashboardStats, SessionConfig } from "@/lib/types";
import { RiskEngine } from "../risk-engine";

describe("RiskEngine", () => {
  const engine = new RiskEngine();
  const config: SessionConfig = {
    strategy: "swing",
    max_position_usd: 500,
    stop_loss_pct: 2,
    take_profit_pct: 4,
    max_concurrent_trades: 2,
    max_consecutive_losers: 5,
    research_depth: "balanced",
    max_api_spend_usd: 10,
    daily_loss_limit_usd: 100,
    profit_target_usd: 250,
    human_approval_required: false,
  };
  const stats: DashboardStats = {
    session_status: "active",
    daily_pnl_usd: 10,
    daily_pnl_pct: 0.2,
    total_trades_today: 3,
    closed_trades_today: 2,
    win_rate_today: 0.5,
    open_trades: 1,
    daily_api_spend: 2,
    api_budget: 10,
    portfolio_value: 100000,
    portfolio_value_source: "broker",
    portfolio_broker_count: 0,
    unrealized_pnl: 0,
    consecutive_losers: 0,
    session_uptime_min: 30,
  };

  it("blocks preflight when broker or AI credentials are missing", () => {
    expect(
      engine.preflightSession({
        config,
        stats,
        brokerConnected: false,
        aiKeyAvailable: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "Broker is not connected",
      gateType: "broker_disconnected",
    });

    expect(
      engine.preflightSession({
        config,
        stats,
        brokerConnected: true,
        aiKeyAvailable: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "Anthropic API key is not configured",
      gateType: "ai_key_missing",
    });
  });

  it("caps order size to the configured max position", () => {
    const result = engine.validateDecision({
      config,
      stats,
      confidence: 0.8,
      order: {
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 900,
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.value?.sizeUsd).toBe(500);
    expect(result.reason).toMatch(/reduced to configured maximum/i);
  });

  it("caps prediction-market exposure before returning the order", () => {
    const result = engine.validateDecision({
      config,
      stats,
      confidence: 0.9,
      maxExposureUsd: 120,
      order: {
        instrumentSymbol: "POLY-YES",
        instrumentType: "prediction_market",
        side: "BUY",
        sizeUsd: 200,
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.value?.sizeUsd).toBe(120);
    expect(result.reason).toMatch(/max exposure/i);
  });

  it("blocks concurrent cap and asset-group exposure", () => {
    expect(
      engine.validateDecision({
        config,
        stats: { ...stats, open_trades: 2 },
        confidence: 0.9,
        order: {
          instrumentSymbol: "AAPL",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 100,
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "Maximum concurrent trades reached",
      gateType: "concurrent_cap",
    });

    expect(
      engine.validateDecision({
        config,
        stats,
        confidence: 0.9,
        assetGroup: "equities_beta",
        openExposureByGroupUsd: { equities_beta: 900 },
        maxSameGroupExposureUsd: 1000,
        order: {
          instrumentSymbol: "AAPL",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 200,
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "Asset group equities_beta exposure cap reached",
      gateType: "position_size",
    });
  });

  it("applies ATR vol-target sizing when configured", () => {
    const result = engine.validateDecision({
      config,
      stats: { ...stats, portfolio_value: 100_000 },
      confidence: 0.9,
      sizingMode: "atr_vol_target",
      atrUsd: 2,
      riskPerTradePct: 0.01,
      order: {
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 5000,
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.value?.sizeUsd).toBe(500);
  });

  it("blocks decisions when spread exceeds volatility halt threshold", () => {
    const result = engine.validateDecision({
      config,
      stats,
      order: {
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 200,
      },
      confidence: 0.9,
      quoteSnapshot: {
        price: 100,
        spreadPct: 1.2,
        timestamp: new Date().toISOString(),
      },
      volatilityHaltMaxSpreadPct: 0.5,
    });

    expect(result.allowed).toBe(false);
    expect(result.gateType).toBe("volatility_halt");
  });
});
