/** EDGAR 8-K item codes under active research. */
export const EDGAR_RESEARCH_ITEM_CODES = [
  "1.01",
  "1.03",
  "2.02",
  "2.03",
  "3.02",
  "5.02",
  "8.01",
] as const;

export type EdgarResearchItemCode = (typeof EDGAR_RESEARCH_ITEM_CODES)[number];

export const EDGAR_DEFAULT_WHITELIST: EdgarResearchItemCode[] = [
  "1.01",
  "2.02",
  "8.01",
];

export const EDGAR_EXPERIMENTAL_ITEM_CODES: EdgarResearchItemCode[] = [
  "1.03",
  "2.03",
  "3.02",
  "5.02",
];
