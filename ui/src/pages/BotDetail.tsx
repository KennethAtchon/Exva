import { reasonHint, reasonText } from "@shared/reasons.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { api, useAccounts, useBots, useStrategies, useSummary } from "../api.ts";
import { DecisionList, TradesPanel } from "../components/bits.tsx";
import { CandleChart } from "../components/charts.tsx";
import {
  Button,
  Card,
  cx,
  Dot,
  ErrorText,
  Icon,
  KindBadge,
  Modal,
  Notice,
  Stat,
  Switch,
  Tabs,
} from "../components/ui.tsx";
import { dateTime, pnlColor, usd } from "../format.ts";

export function BotDetail({ id }: { id: string }) {
  const { data, error } = useQuery({ queryKey: ["bot", id], queryFn: () => api.bot(id) });
  const { data: summary } = useSummary(id);
  const { data: bots = [] } = useBots();
  const strategy = useStrategies().data?.find((s) => s.id === data?.bot.strategyId);
  const account = useAccounts().data?.find((a) => a.id === data?.bot.accountId);
  const [tab, setTab] = useState<"activity" | "trades" | "settings">("activity");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [closePositions, setClosePositions] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const client = useQueryClient();
  const [, navigate] = useLocation();

  if (error) return <ErrorText error={error} />;
  if (!data) return null;
  const { bot, warnings } = data;
  const active = symbol ?? bot.symbols[0] ?? "";
  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await client.invalidateQueries();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-medium">
            <Dot tone={bot.status === "running" ? "ok" : "off"} /> {bot.name}
          </h1>
          <div className="mt-1 text-sm text-ink3">
            {strategy?.name} · {bot.timeframe} · {account?.name ?? "?"} · {usd(bot.dollarsPerTrade)}{" "}
            per trade
            {bot.backtestId && (
              <>
                {" · "}
                <Link href={`/lab?run=${bot.backtestId}`} className="underline hover:text-ink">
                  from a Lab run
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/lab?bot=${bot.id}`}>
            <Button variant="ghost">
              <Icon name="flask" /> Test in Lab
            </Button>
          </Link>
          <Link href={`/bots/${bot.id}/edit`}>
            <Button>
              <Icon name="edit" /> Edit
            </Button>
          </Link>
          {bot.status === "running" ? (
            <Button variant="danger" onClick={() => setStopping(true)}>
              <Icon name="stop" /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={() => act(() => api.startBot(bot.id))}>
              <Icon name="play" /> Start
            </Button>
          )}
        </div>
      </div>
      <ErrorText error={actionError} />
      {warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <WhyCard botId={bot.id} running={bot.status === "running"} />

      <Card
        title="Chart"
        actions={bot.symbols.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            className={cx(
              "font-mono text-label",
              s === active ? "text-ink" : "text-ink3 hover:text-ink",
            )}
          >
            {s}
          </button>
        ))}
      >
        <BotChart symbol={active} timeframe={bot.timeframe} botId={bot.id} />
      </Card>

      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "activity", label: "Activity" },
            {
              value: "trades",
              label: `Trades${summary?.openPositions ? ` (${summary.openPositions} open)` : ""}`,
            },
            { value: "settings", label: "Settings" },
          ]}
        />
        <div className="pt-3">
          {tab === "activity" && <DecisionList botId={bot.id} />}
          {tab === "trades" && <TradesPanel botId={bot.id} bots={bots} />}
          {tab === "settings" && (
            <div className="space-y-4 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row k="Symbols" v={bot.symbols.join(", ")} />
                <Row k="Timeframe" v={bot.timeframe} />
                {Object.entries(bot.params).map(([k, v]) => (
                  <Row
                    key={k}
                    k={String(
                      (
                        strategy?.params.properties as
                          | Record<string, { title?: string }>
                          | undefined
                      )?.[k]?.title ?? k,
                    )}
                    v={String(v)}
                  />
                ))}
                <Row k="Stop-loss" v={bot.risk.stopLossPct ? `${bot.risk.stopLossPct}%` : "none"} />
                <Row
                  k="Take-profit"
                  v={bot.risk.takeProfitPct ? `${bot.risk.takeProfitPct}%` : "none"}
                />
                <Row
                  k="Max hold"
                  v={bot.risk.maxHoldBars ? `${bot.risk.maxHoldBars} bars` : "none"}
                />
                <Row k="Max positions" v={String(bot.risk.maxPositions)} />
                <Row
                  k="Daily loss limit"
                  v={bot.risk.dailyLossLimitUsd ? usd(bot.risk.dailyLossLimitUsd) : "off"}
                />
              </dl>
              {bot.status === "stopped" && (
                <Button
                  variant="danger"
                  onClick={() =>
                    act(async () => {
                      await api.deleteBot(bot.id);
                      navigate("/bots");
                    })
                  }
                >
                  <Icon name="trash" /> Delete bot
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Modal open={stopping} onClose={() => setStopping(false)} title={`Stop ${bot.name}?`}>
        <p className="mb-4 text-sm text-ink2">
          The bot stops checking. Its open positions stay open unless you close them now.
        </p>
        <Switch
          checked={closePositions}
          onChange={setClosePositions}
          label="Also sell all of this bot's open positions"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStopping(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              act(async () => {
                await api.stopBot(bot.id, closePositions);
                setStopping(false);
              })
            }
          >
            Stop bot
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hair py-1">
      <dt className="text-ink3">{k}</dt>
      <dd className="truncate text-right font-mono text-xs leading-5">{v}</dd>
    </div>
  );
}

/** The answer to "why isn't it trading?", on top of every bot page. */
function WhyCard({ botId, running }: { botId: string; running: boolean }) {
  const { data: s } = useSummary(botId);
  if (!s) return null;
  const noTrades = s.counts.buy + s.counts.sell === 0;
  return (
    <Card title={noTrades ? "Why no trades today?" : "Today"}>
      <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
        <Stat label="Checks" value={s.checks} />
        <Stat label="Buys" value={s.counts.buy} tone={s.counts.buy ? "text-up" : undefined} />
        <Stat label="Sells" value={s.counts.sell} tone={s.counts.sell ? "text-down" : undefined} />
        <Stat label="Holds" value={s.counts.hold} />
        <Stat label="Skips" value={s.counts.skip} tone={s.counts.skip ? "text-warn" : undefined} />
        <Stat
          label="P&L"
          value={usd(s.pnlToday, true)}
          tone={pnlColor(s.pnlToday)}
          sub={`${s.tradesToday} closed trades`}
        />
      </div>
      <div className="mt-4 space-y-1.5 text-sm">
        {s.byCode.slice(0, 5).map((c) => (
          <div key={`${c.kind}-${c.code}`} className="flex items-start gap-3">
            <span className="w-10 shrink-0 text-right font-mono text-xs leading-5 text-ink3">
              {c.count}×
            </span>
            <KindBadge kind={c.kind} />
            <span className="text-ink2">
              {reasonText(c.code)}
              {reasonHint(c.code) && (c.kind === "skip" || c.kind === "error") && (
                <span className="text-ink3">. {reasonHint(c.code)}</span>
              )}
            </span>
          </div>
        ))}
        {s.closest && (
          <div className="pt-1 text-ink2">
            <span className="text-ink3">Closest to trading:</span> {s.closest.symbol} at{" "}
            {dateTime(s.closest.barTs)}: {s.closest.message}
          </div>
        )}
        {!running && <div className="text-ink3">This bot is stopped.</div>}
        {running && s.sleepingUntil && (
          <div className="text-ink3">
            Sleeping until the market opens at {dateTime(s.sleepingUntil)}.
          </div>
        )}
        {running && !s.sleepingUntil && s.nextCheckAt && (
          <div className="text-ink3">Next check at {dateTime(s.nextCheckAt)}.</div>
        )}
        {s.checks === 0 && running && (
          <div className="text-ink3">
            No checks yet today. The first one happens when the next bar closes.
          </div>
        )}
      </div>
    </Card>
  );
}

function BotChart({
  symbol,
  timeframe,
  botId,
}: {
  symbol: string;
  timeframe: "5m" | "15m" | "1h";
  botId: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["chart", symbol, timeframe, botId],
    queryFn: () => api.chart({ symbol, timeframe, bot: botId }),
    refetchInterval: 60_000,
  });
  if (error) return <ErrorText error={error} />;
  if (isLoading) return <div className="h-[320px]" />;
  if (!data?.bars.length)
    return <div className="py-16 text-center text-sm text-ink3">No bars for {symbol} yet.</div>;
  return <CandleChart data={data} timeframe={timeframe} />;
}
