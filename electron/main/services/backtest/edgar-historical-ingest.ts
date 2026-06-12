/**
 * Historical EDGAR 8-K ingest for offline drift backtest (audit §2.3, §7-#1).
 * Fetches recent filings from SEC full-text search and parses item codes.
 */

import type { FilingRecord } from "./edgar-drift-backtest";

const SEC_FULL_TEXT_SEARCH =
  "https://efts.sec.gov/LATEST/search-index?q=%22form-type%22%3A%228-K%22&dateRange=custom&startdt={start}&enddt={end}&from=0&size=100";

type SecSearchHit = {
  adsh?: string;
  file_date?: string;
  display_names?: string[];
  form_type?: string;
  items?: string[];
};

export type IngestOptions = {
  startDate: string;
  endDate: string;
  itemCodeWhitelist?: string[];
  maxFilings?: number;
};

/** Parse item codes from SEC search hit (e.g. ["1.01", "2.02"]). */
export function parseItemCodesFromHit(hit: SecSearchHit): string[] {
  if (!hit.items?.length) return [];
  return hit.items
    .map((item) => item.trim())
    .filter((code) => /^\d+\.\d+$/.test(code));
}

function tickerFromDisplayNames(names?: string[]): string | null {
  if (!names?.length) return null;
  const first = names[0] ?? "";
  const match = first.match(/\(([A-Z]{1,5}(?:-[A-Z]+)?)\)/);
  return match?.[1] ?? null;
}

export async function fetchEdgarFilings(
  options: IngestOptions,
): Promise<FilingRecord[]> {
  const url = SEC_FULL_TEXT_SEARCH.replace(
    "{start}",
    options.startDate,
  ).replace("{end}", options.endDate);
  const response = await fetch(url, {
    headers: { "User-Agent": "Exva/0.1 (backtest; contact@example.com)" },
  });
  if (!response.ok) {
    throw new Error(
      `SEC search failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as {
    hits?: { hits?: Array<{ _source?: SecSearchHit }> };
  };
  const hits = body.hits?.hits ?? [];
  const max = options.maxFilings ?? 500;
  const whitelist = options.itemCodeWhitelist;
  const filings: FilingRecord[] = [];

  for (const hit of hits.slice(0, max)) {
    const source = hit._source;
    if (!source?.adsh || !source.file_date) continue;
    const itemCodes = parseItemCodesFromHit(source);
    if (whitelist?.length && !itemCodes.some((c) => whitelist.includes(c))) {
      continue;
    }
    const ticker = tickerFromDisplayNames(source.display_names);
    if (!ticker) continue;
    filings.push({
      accessionNumber: source.adsh,
      ticker,
      filedAt: `${source.file_date}T16:00:00.000Z`,
      itemCodes,
    });
  }
  return filings;
}
