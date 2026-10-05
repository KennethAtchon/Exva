// Read-only assistant drawer. Anything it suggests arrives as a button the user clicks.
import type { Proposal } from "@shared/types.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { api, type BacktestRequest, type BotInput } from "../api.ts";
import { Button, cx, Icon, TextArea } from "./ui.tsx";

interface Msg {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
}

export function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const client = useQueryClient();

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.assistant(next.map(({ role, content }) => ({ role, content })));
      setMessages([...next, { role: "assistant", content: res.reply, proposals: res.proposals }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async (p: Proposal) => {
    try {
      const payload = p.payload as Record<string, unknown>;
      const botId = String(payload.botId ?? "");
      if (p.action === "start_bot") await api.startBot(botId);
      else if (p.action === "stop_bot") await api.stopBot(botId);
      else if (p.action === "update_bot") {
        const { botId: _, ...patch } = payload;
        await api.updateBot(botId, patch as Partial<BotInput>);
      } else if (p.action === "create_bot") {
        const { bot } = await api.createBot(payload as unknown as BotInput);
        navigate(`/bots/${bot.id}`);
      } else if (p.action === "run_backtest") {
        const req = {
          days: 30,
          params: {},
          risk: {
            stopLossPct: null,
            takeProfitPct: null,
            maxHoldBars: null,
            maxPositions: 10,
            dailyLossLimitUsd: 0,
          },
          ...payload,
        };
        const { id } = await api.startBacktest(req as unknown as BacktestRequest);
        navigate(`/lab?run=${id}`);
      }
      client.invalidateQueries();
      setMessages((m) => [...m, { role: "assistant", content: `Done: ${p.label}` }]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <aside
      className={cx(
        "fixed top-0 right-0 bottom-8 z-40 flex w-[380px] flex-col border-l border-line bg-surface shadow-2xl transition-transform",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex items-center justify-between border-b border-hair px-4 py-3">
        <span className="flex items-center gap-2 font-medium">
          <Icon name="spark" className="text-ai" /> Assistant
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-ink3 hover:text-ink"
          aria-label="Close assistant"
        >
          <Icon name="x" />
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2 text-ink3">
            <p>
              Ask about your bots. I can read everything and run backtests, but I only change things
              when you click a button.
            </p>
            {[
              "Why hasn't ETF Dip Buyer traded today?",
              "How did my bots do this week?",
              "Would a 1h timeframe trade more?",
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setDraft(q)}
                className="block text-left text-ink2 hover:text-ink"
              >
                “{q}”
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cx(
              "rounded px-3 py-2",
              m.role === "user" ? "ml-8 bg-surface3" : "mr-4 bg-surface2",
            )}
          >
            <div className="whitespace-pre-wrap text-ink2">{m.content}</div>
            {m.proposals?.map((p, j) => (
              <Button
                key={j}
                size="sm"
                variant="primary"
                className="mt-2 w-full"
                onClick={() => run(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        ))}
        {busy && <div className="text-ink3">Thinking…</div>}
        {error && <div className="text-down">{error}</div>}
      </div>
      <div className="border-t border-hair p-3">
        <TextArea
          rows={2}
          value={draft}
          placeholder="Ask anything about your bots…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => setMessages([])}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={send} disabled={busy || !draft.trim()}>
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
