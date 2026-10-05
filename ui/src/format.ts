import { reasonHint, reasonText } from "@shared/reasons.ts";
import type { DecisionKind } from "@shared/types.ts";

export { reasonHint, reasonText };

export function usd(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const d = digits ?? (abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function pct(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function time(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? time(ts)
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time(ts)}`;
}

export function relative(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const text =
    mins < 1
      ? "now"
      : mins < 60
        ? `${mins} min`
        : mins < 48 * 60
          ? `${Math.round(mins / 60)} h`
          : `${Math.round(mins / 1440)} d`;
  if (text === "now") return text;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

export const KIND_STYLE: Record<DecisionKind, string> = {
  buy: "text-up bg-up/10 border-up/30",
  sell: "text-down bg-down/10 border-down/30",
  hold: "text-ink2 bg-surface3/60 border-line",
  skip: "text-warn bg-warn/10 border-warn/30",
  error: "text-down bg-down/10 border-down/30",
};

export const pnlColor = (n: number | null | undefined) =>
  !n ? "text-ink2" : n > 0 ? "text-up" : "text-down";

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]): void {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
