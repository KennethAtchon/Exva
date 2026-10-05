import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { PageTitle } from "../App.tsx";
import { api, useBots, useStatus } from "../api.ts";
import { BotCard } from "../components/bits.tsx";
import { EquityChart } from "../components/charts.tsx";
import { Button, Card, cx, Empty, Icon, Stat } from "../components/ui.tsx";
import { dateTime, pnlColor, usd } from "../format.ts";

const RANGES = { "1D": 1, "1W": 7, "1M": 30, All: 3650 } as const;
const DAY = 86_400_000;

export function Home() {
  const { data: status } = useStatus();
  const { data: bots = [] } = useBots();
  const summaries = useQueries({
    queries: bots.map((b) => ({ queryKey: ["summary", b.id], queryFn: () => api.summary(b.id) })),
  });
  const [range, setRange] = useState<keyof typeof RANGES>("1W");
  const now = status?.now ?? Date.now();
  const { data: equity = [] } = useQuery({
    queryKey: ["equity", range, Math.floor(now / 60_000)],
    queryFn: () => api.equity({ from: now - RANGES[range] * DAY, to: now }),
    enabled: Boolean(status),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: () => api.events({ limit: 30 }),
  });

  const total = (f: (s: NonNullable<(typeof summaries)[number]["data"]>) => number) =>
    summaries.reduce((sum, q) => sum + (q.data ? f(q.data) : 0), 0);
  const account = status?.accounts[0];
  const pnlToday = total((s) => s.pnlToday);
  const sorted = [...bots].sort(
    (a, b) => Number(b.status === "running") - Number(a.status === "running"),
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Home"
        actions={
          <Link href="/bots/new">
            <Button variant="primary">
              <Icon name="plus" /> New bot
            </Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 rounded border border-line bg-surface p-4 md:grid-cols-4">
        <Stat label="Equity" value={usd(account?.equity)} sub={account?.name ?? "No account"} />
        <Stat
          label="Today"
          value={usd(pnlToday, true)}
          tone={pnlColor(pnlToday)}
          sub="realized + open"
        />
        <Stat label="Open positions" value={total((s) => s.openPositions)} />
        <Stat
          label="Trades today"
          value={total((s) => s.tradesToday)}
          sub={`${total((s) => s.checks)} checks`}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Equity"
          actions={(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cx(
                "font-mono text-label",
                range === r ? "text-ink" : "text-ink3 hover:text-ink",
              )}
            >
              {r}
            </button>
          ))}
        >
          {equity.length > 1 ? (
            <EquityChart points={equity} />
          ) : (
            <Empty>The equity curve fills in as the engine runs (a point every 5 minutes).</Empty>
          )}
        </Card>
        <JournalCard />
      </div>
      <Card
        title="Bots"
        actions={
          <Link href="/bots" className="text-xs text-ink3 hover:text-ink">
            All bots →
          </Link>
        }
      >
        {sorted.length === 0 ? (
          <Empty>
            No bots yet.{" "}
            <Link href="/bots/new" className="text-ink underline">
              Create your first bot
            </Link>
            .
          </Empty>
        ) : (
          <div className="space-y-2">
            {sorted.map((b) => (
              <BotCard key={b.id} bot={b} />
            ))}
          </div>
        )}
      </Card>
      <Card title="Activity">
        {events.length === 0 ? (
          <Empty>Fills, bot changes and warnings show up here.</Empty>
        ) : (
          <ul className="divide-y divide-hair text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 py-1.5">
                <span className="w-24 shrink-0 font-mono text-xs leading-5 text-ink3">
                  {dateTime(e.ts)}
                </span>
                <span
                  className={cx(
                    "min-w-0 flex-1",
                    e.level === "error"
                      ? "text-down"
                      : e.level === "warn"
                        ? "text-warn"
                        : "text-ink2",
                  )}
                >
                  {e.kind === "journal" ? "Morning journal written" : e.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function JournalCard() {
  const { data: journal } = useQuery({ queryKey: ["journal"], queryFn: api.journal });
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true);
    try {
      await api.writeJournal();
      await client.invalidateQueries({ queryKey: ["journal"] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={journal ? `Journal · ${journal.date}` : "Journal"}
      actions={
        <Button size="sm" variant="ghost" onClick={write} disabled={busy}>
          {busy ? "Writing…" : "Write now"}
        </Button>
      }
    >
      {journal ? (
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink2">
          {journal.text}
        </p>
      ) : (
        <Empty>
          Every morning the AI summarizes the last 24 hours here. Set the time in Settings.
        </Empty>
      )}
    </Card>
  );
}
