// Small helpers with no domain knowledge.

let counter = 0;
/** Time-sortable id: prefix_<ms base36><counter><random>. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${rand}`;
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Local-midnight of the day containing ts (machine time zone). */
export function localDayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Fast thousands-separated formatting (toLocaleString is slow in hot loops). */
function grouped(n: number, digits: number, trim: boolean): string {
  let [int, frac = ""] = Math.abs(n).toFixed(digits).split(".") as [string, string?];
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (trim) frac = frac.replace(/0+$/, "");
  return `${n < 0 ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export function usd(n: number): string {
  return n < 0 ? `-$${grouped(-n, 2, false)}` : `$${grouped(n, 2, false)}`;
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  return grouped(n, abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6, true);
}

export function hhmm(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Run tasks with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
