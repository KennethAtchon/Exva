import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, useStatus } from "../api.ts";
import { dateTime, usd } from "../format.ts";
import { Button, Dot, Modal } from "./ui.tsx";

/** Always visible: is everything healthy, and the one-click kill switch. */
export function StatusBar() {
  const { data: s, error } = useStatus();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const toggle = async (on: boolean) => {
    await api.killSwitch(on);
    setConfirm(false);
    client.invalidateQueries({ queryKey: ["status"] });
  };
  if (error) {
    return (
      <footer className="flex h-8 items-center gap-2 border-t border-line bg-surface px-3 text-xs text-down">
        <Dot tone="error" /> Engine not reachable. Is Exva running?
      </footer>
    );
  }
  if (!s) return <footer className="h-8 border-t border-line bg-surface" />;
  const sep = <span className="text-ink3">·</span>;
  return (
    <footer className="flex h-8 shrink-0 items-center gap-2.5 overflow-hidden whitespace-nowrap border-t border-line bg-surface px-3 font-mono text-[11px] text-ink2">
      <Dot tone={s.health} />
      <span className="text-ink">{s.mode === "demo" ? "Demo engine" : "Engine running"}</span>
      {sep}
      <span>
        {s.botsRunning} bot{s.botsRunning === 1 ? "" : "s"} running
      </span>
      {s.accounts.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5">
          {sep} {a.name} <span className={a.ok ? "text-up" : "text-down"}>{a.ok ? "✓" : "✗"}</span>
        </span>
      ))}
      {sep}
      <span className={s.data.ok ? "" : "text-down"}>Data {s.data.ok ? "✓" : "✗"}</span>
      {sep}
      <span className={s.ai.configured && !s.ai.ok ? "text-warn" : ""}>
        {s.ai.configured ? `AI ${usd(s.ai.spentTodayUsd)}/${usd(s.ai.budgetUsd)}` : "AI off"}
      </span>
      {sep}
      <span>
        {s.market.stocksOpen
          ? `NYSE open${s.market.nextClose ? ` until ${dateTime(s.market.nextClose)}` : ""}`
          : `NYSE closed${s.market.nextOpen ? ` (opens ${dateTime(s.market.nextOpen)})` : ""}`}
      </span>
      {sep}
      <span>Crypto open</span>
      {s.sleepGaps.length > 0 && (
        <>
          {sep}
          <span className="text-warn">
            Not running {dateTime(s.sleepGaps[0]!.from)}–{dateTime(s.sleepGaps[0]!.to)}
          </span>
        </>
      )}
      <div className="ml-auto">
        {s.killSwitch ? (
          <Button size="sm" variant="danger" onClick={() => toggle(false)} className="h-6">
            TRADING STOPPED · Resume
          </Button>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)} className="h-6">
            ■ Stop all
          </Button>
        )}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Stop all trading?">
        <p className="mb-4 text-sm text-ink2">
          The kill switch blocks every new order, buys and sells, until you resume. Bots keep
          checking and record "kill switch" decisions. Open positions stay open.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => toggle(true)}>
            Stop all trading
          </Button>
        </div>
      </Modal>
    </footer>
  );
}
