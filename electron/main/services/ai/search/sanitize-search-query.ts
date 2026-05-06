/** plan §8 — truncate, strip filler, keep encoding-safe text for fetch (encodeURIComponent applied by adapters). */
export function sanitizeSearchQuery(raw: string): string {
  let q = raw.trim();
  q = q.replace(/^\s*(i'?ll search for|let me (look up|search)|here'?s a search for)[^.:\n]*[.:]?\s*/i, "").trim();
  return q.length > 200 ? q.slice(0, 200) : q;
}
