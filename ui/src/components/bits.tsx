// Pieces several screens share: bot cards, the decision list, trade tables, Explain.
import type { Bot, Decision, Trade } from "@shared/types.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { api, useStrategies, useSummary } from "../api.ts";
import { dateTime, downloadCsv, num, pct, pnlColor, reasonHint, usd } from "../format.ts";
import { Button, cx, Dot, Empty, Icon, KindBadge, Modal, Tabs } from "./ui.tsx";

export function BotCard({ bot }: { bot: Bot }) {
  const { data: s } = useSummary(bot.id);
  const strategy = useStrategies().data?.find((x) => x.id === bot.strategyId);
  const last = s?.lastDecision;
  return (
    <Link
      href={`/bots/${bot.id}`}
      className="block rounded border border-line bg-surface p-3 transition-colors hover:border-ink3"
    >
      <div className="flex items-center gap-2">
        <Dot tone={bot.status === "running" ? "ok" : "off"} />
        <span className="font-medium">{bot.name}</span>
        {strategy?.isTest && (
          <span className="rounded bg-surface3 px-1.5 font-mono text-label text-ink2">TEST</span>
        )}
        {strategy?.usesAi && (
          <span className="rounded bg-ai/15 px-1.5 font-mono text-label text-ai">AI</span>
        )}
        <span className="ml-auto font-mono text-sm">
          <span className={pnlColor(s?.pnlToday)}>{usd(s?.pnlToday, true)}</span>
          <span className="ml-3 text-ink3">{s?.tradesToday ?? 0} trades today</span>
        </span>
      </div>
      <div className="mt-1 truncate pl-4 text-xs text-ink3">
        {strategy?.name ?? bot.strategyId} · {bot.symbols.join(" ")} · {bot.timeframe}
        {bot.status === "running" && s?.sleepingUntil
          ? ` · Sleeping until ${dateTime(s.sleepingUntil)}`
          : ""}
        {bot.status === "running" && !s?.sleepingUntil && s?.nextCheckAt
          ? ` · Next check ${dateTime(s.nextCheckAt)}`
          : ""}
        {bot.status === "stopped" ? " · Stopped" : ""}
      </div>
      {last && (
        <div className="mt-2 flex items-center gap-2 pl-4 text-sm">
          <KindBadge kind={last.kind} />
          <span className="font-mono text-xs text-ink3">{dateTime(last.barTs)}</span>
          <span className="text-ink3">{last.symbol}</span>
          <span className="truncate text-ink2">{last.message}</span>
        </div>
      )}
    </Link>
  );
}

const FILTERS = {
  all: undefined,
  trades: "buy,sell",
  holds: "hold",
  skips: "skip",
  errors: "error",
} as const;

export function DecisionList({ botId, symbol }: { botId: string; symbol?: string }) {
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  const [explainId, setExplainId] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["decisions", botId, filter, symbol],
    queryFn: () => api.decisions(botId, { kinds: FILTERS[filter], symbol, limit: 200 }),
  });
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cx(
              "rounded px-2.5 py-1 text-xs capitalize",
              filter === f ? "bg-surface3 text-ink" : "text-ink2 hover:text-ink",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      {isLoading ? null : data.length === 0 ? (
        <Empty>No decisions yet. The bot records one every time a bar closes.</Empty>
      ) : (
        <ul className="divide-y divide-hair">
          {data.map((d) => (
            <DecisionRow key={d.id} d={d} onExplain={() => setExplainId(d.id)} />
          ))}
        </ul>
      )}
      <ExplainModal
        target={explainId ? { decisionId: explainId } : null}
        onClose={() => setExplainId(null)}
      />
    </div>
  );
}

function DecisionRow({ d, onExplain }: { d: Decision; onExplain: () => void }) {
  const hint = d.kind === "skip" || d.kind === "error" ? reasonHint(d.code) : undefined;
  return (
    <li className="group flex items-start gap-3 py-2 text-sm">
      <span className="w-24 shrink-0 font-mono text-xs leading-5 text-ink3">
        {dateTime(d.barTs)}
      </span>
      <span className="w-20 shrink-0 font-mono text-xs leading-5 text-ink2">{d.symbol}</span>
      <KindBadge kind={d.kind} />
      <div className="min-w-0 flex-1">
        <div className="text-ink2">{d.message}</div>
        {hint && <div className="text-xs text-ink3">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={onExplain}
        className="shrink-0 text-xs text-ink3 opacity-0 hover:text-ai group-hover:opacity-100"
      >
        Explain
      </button>
    </li>
  );
}

export function ExplainModal({
  target,
  onClose,
}: {
  target: { decisionId?: string; tradeId?: string } | null;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["explain", target],
    queryFn: () => api.explain(target ?? {}),
    enabled: Boolean(target),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Why?">
      {isLoading && <div className="text-sm text-ink3">Asking the AI…</div>}
      {error && <div className="text-sm text-down">{(error as Error).message}</div>}
      {data && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink2">{data.text}</p>}
    </Modal>
  );
}

export function TradesTable({
  trades,
  bots,
  showBot = true,
}: {
  trades: Trade[];
  bots?: Bot[];
  showBot?: boolean;
}) {
  const [explainId, setExplainId] = useState<string | null>(null);
  const name = (id: string) => bots?.find((b) => b.id === id)?.name ?? "";
  if (!trades.length) return <Empty>No trades yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-mono text-label uppercase text-ink3">
            {showBot && <th className="py-2 pr-3 font-normal">Bot</th>}
            <th className="py-2 pr-3 font-normal">Symbol</th>
            <th className="py-2 pr-3 font-normal">Opened</th>
            <th className="py-2 pr-3 text-right font-normal">Qty</th>
            <th className="py-2 pr-3 text-right font-normal">Entry</th>
            <th className="py-2 pr-3 text-right font-normal">Exit / last</th>
            <th className="py-2 pr-3 text-right font-normal">P&amp;L</th>
            <th className="py-2 pr-3 font-normal">Closed</th>
            <th className="py-2 font-normal" />
          </tr>
        </thead>
        <tbody className="divide-y divide-hair font-mono text-xs">
          {trades.map((t) => {
            const open = t.status === "open";
            const pnl = open ? t.unrealizedPnl : t.pnlUsd;
            return (
              <tr key={t.id} className="group">
                {showBot && <td className="py-2 pr-3 font-sans text-sm">{name(t.botId)}</td>}
                <td className="py-2 pr-3">{t.symbol}</td>
                <td className="py-2 pr-3 text-ink2">{dateTime(t.openedAt)}</td>
                <td className="py-2 pr-3 text-right text-ink2">
                  {num(t.qty - (open ? t.exitQty : 0), 6)}
                </td>
                <td className="py-2 pr-3 text-right">{num(t.entryPrice)}</td>
                <td className="py-2 pr-3 text-right">
                  {open ? (
                    num(t.lastPrice)
                  ) : t.exitReason === "closed_outside_exva" ? (
                    <span className="font-sans text-xs text-warn">sold outside Exva</span>
                  ) : (
                    num(t.exitPrice)
                  )}
                </td>
                <td className={cx("py-2 pr-3 text-right", pnlColor(pnl))}>
                  {usd(pnl, true)} {!open && <span className="text-ink3">{pct(t.pnlPct)}</span>}
                </td>
                <td className="py-2 pr-3 text-ink2">
                  {open ? (
                    <span className="text-info">open</span>
                  ) : t.closedAt ? (
                    dateTime(t.closedAt)
                  ) : (
                    ""
                  )}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setExplainId(t.id)}
                    className="font-sans text-xs text-ink3 opacity-0 hover:text-ai group-hover:opacity-100"
                  >
                    Explain
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ExplainModal
        target={explainId ? { tradeId: explainId } : null}
        onClose={() => setExplainId(null)}
      />
    </div>
  );
}

export function exportTrades(trades: Trade[], bots: Bot[]): void {
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  downloadCsv("exva-trades.csv", [
    [
      "bot",
      "symbol",
      "status",
      "opened",
      "qty",
      "entry",
      "exit",
      "pnl_usd",
      "pnl_pct",
      "closed",
      "exit_reason",
    ],
    ...trades.map((t) => [
      name(t.botId),
      t.symbol,
      t.status,
      new Date(t.openedAt).toISOString(),
      t.qty,
      t.entryPrice,
      t.exitPrice,
      t.pnlUsd,
      t.pnlPct,
      t.closedAt ? new Date(t.closedAt).toISOString() : "",
      t.exitReason,
    ]),
  ]);
}

export function TradesPanel({ botId, bots }: { botId?: string; bots: Bot[] }) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const { data = [] } = useQuery({
    queryKey: ["trades", botId, tab],
    queryFn: () => api.trades({ bot: botId, status: tab, limit: 500 }),
  });
  return (
    <div>
      <div className="flex items-end justify-between">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "open", label: "Open positions" },
            { value: "closed", label: "Trade history" },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => exportTrades(data, bots)}
          disabled={!data.length}
        >
          <Icon name="download" /> CSV
        </Button>
      </div>
      <div className="pt-2">
        <TradesTable trades={data} bots={bots} showBot={!botId} />
      </div>
    </div>
  );
}
