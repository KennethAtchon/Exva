/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  extractTickers,
  newsContradictionFlag,
  parseRssXml,
  polarityFromHeadline,
} from "../sources/news-source";
import { enrichWithNewsContext } from "../news/news-context-enrichment";

describe("news RSS context enrichment", () => {
  it("parses RSS items and extracts tickers", () => {
    const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Acme Corp (ACME) beats estimates</title>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jul 2026 12:00:00 GMT</pubDate>
        <description>$TSLA also mentioned</description>
      </item>
    </channel></rss>`;
    const items = parseRssXml(xml);
    expect(items).toHaveLength(1);
    expect(
      extractTickers(`${items[0]!.title} ${items[0]!.description}`),
    ).toEqual(expect.arrayContaining(["ACME", "TSLA"]));
    expect(polarityFromHeadline(items[0]!.title)).toBe("positive");
  });

  it("flags contradicting coincident news", () => {
    const flag = newsContradictionFlag({
      primaryPolarity: "positive",
      newsPolarities: ["negative", "unclear"],
    });
    expect(flag.contradicted).toBe(true);
  });

  it("enriches evidence without creating candidates", () => {
    const result = enrichWithNewsContext({
      symbol: "ACME",
      primaryPolarity: "positive",
      nowMs: Date.parse("2026-07-01T12:00:00.000Z"),
      news: [
        {
          headline: "Acme lawsuit filed",
          url: "https://example.com/n",
          publishedAt: "2026-07-01T11:00:00.000Z",
          sourceQuality: "wire",
          tickersMentioned: ["ACME"],
          polarityHint: "negative",
        },
      ],
    });
    expect(result.headlines).toHaveLength(1);
    expect(result.contradiction.contradicted).toBe(true);
  });
});
