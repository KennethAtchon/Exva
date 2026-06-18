/**
 * Historical EDGAR 8-K ingest helpers for the offline drift backtest
 * (audit §2.3, §7-#1). Parses item codes from SEC full-text search hits.
 */

type SecSearchHit = {
  adsh?: string;
  file_date?: string;
  display_names?: string[];
  form_type?: string;
  items?: string[];
};

/** Parse item codes from SEC search hit (e.g. ["1.01", "2.02"]). */
export function parseItemCodesFromHit(hit: SecSearchHit): string[] {
  if (!hit.items?.length) return [];
  return hit.items
    .map((item) => item.trim())
    .filter((code) => /^\d+\.\d+$/.test(code));
}
