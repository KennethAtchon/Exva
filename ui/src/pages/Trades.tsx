import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageTitle } from "../App.tsx";
import { api, useBots } from "../api.ts";
import { TradesPanel } from "../components/bits.tsx";
import { Card, cx, Empty, Select, Tabs } from "../components/ui.tsx";
import { dateTime, num } from "../format.ts";

export function Trades() {
  const { data: bots = [] } = useBots();
  const [botId, setBotId] = useState("");
  const [view, setView] = useState<"trades" | "orders">("trades");
  return (
    <div>
      <PageTitle
        title="Trades"
        sub="Every round trip, open position and broker order."
        actions={
          <Select
            value={botId}
            onChange={setBotId}
            className="w-56"
            options={[
              { value: "", label: "All bots" },
              ...bots.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        }
      />
      <Card>
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: "trades", label: "Positions & trades" },
            { value: "orders", label: "Orders" },
          ]}
        />
        <div className="pt-3">
          {view === "trades" ? (
            <TradesPanel key={botId} botId={botId || undefined} bots={bots} />
          ) : (
            <Orders botId={botId || undefined} />
          )}
        </div>
      </Card>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  filled: "text-up",
  rejected: "text-down",
  canceled: "text-ink3",
  expired: "text-ink3",
  submit_unknown: "text-warn",
};

function Orders({ botId }: { botId?: string }) {
  const { data: orders = [] } = useQuery({
    queryKey: ["orders", botId],
    queryFn: () => api.orders({ bot: botId, limit: 300 }),
  });
  const { data: bots = [] } = useBots();
  if (!orders.length) return <Empty>No orders yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-mono text-label uppercase text-ink3">
            {[
              "Time",
              "Bot",
              "Symbol",
              "Side",
              "Size",
              "Status",
              "Filled",
              "Avg price",
              "Client order id",
              "Note",
            ].map((h) => (
              <th key={h} className="py-2 pr-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hair font-mono text-xs">
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="py-2 pr-3 text-ink2">{dateTime(o.createdAt)}</td>
              <td className="py-2 pr-3 font-sans text-sm">
                {bots.find((b) => b.id === o.botId)?.name}
              </td>
              <td className="py-2 pr-3">{o.symbol}</td>
              <td className={cx("py-2 pr-3 uppercase", o.side === "buy" ? "text-up" : "text-down")}>
                {o.side}
              </td>
              <td className="py-2 pr-3">
                {o.notional !== null ? `$${num(o.notional)}` : num(o.qty, 6)}
              </td>
              <td className={cx("py-2 pr-3", STATUS_STYLE[o.status] ?? "text-info")}>
                {o.status.replace("_", " ")}
              </td>
              <td className="py-2 pr-3">{num(o.filledQty, 6)}</td>
              <td className="py-2 pr-3">{num(o.avgFillPrice)}</td>
              <td className="py-2 pr-3 text-ink3">{o.clientOrderId}</td>
              <td className="max-w-64 truncate py-2 font-sans text-ink3">{o.error ?? o.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
