import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { CikTickerCache } from "../../cache/cik-ticker-cache";
import { EdgarSignalSource } from "../edgar-signal-source";

function atomFeed(
  entries: Array<{
    cik: string;
    title: string;
    updated: string;
    summary: string;
    accession: string;
  }>,
): string {
  const body = entries
    .map(
      (entry) => `<entry>
  <id>urn:tag:sec.gov,2008:accession-number=${entry.accession}&amp;CIK=${entry.cik}</id>
  <title>${entry.title}</title>
  <updated>${entry.updated}</updated>
  <summary>${entry.summary}</summary>
  <link href="https://www.sec.gov/Archives/edgar/data/${entry.cik}/${entry.accession.replace(/-/g, "")}/${entry.accession}-index.htm"/>
</entry>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

describe("EdgarSignalSource", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits signals for whitelisted CIKs with matching item codes", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);
    cache.upsert("320193", "AAPL");

    fetchMock.mockResolvedValueOnce(
      new Response(
        atomFeed([
          {
            cik: "320193",
            title: "Apple Inc.",
            updated: "2024-06-01T15:00:00Z",
            summary: "Item 1.01 Entry into a Material Definitive Agreement",
            accession: "0000320193-24-000001",
          },
          {
            cik: "1045810",
            title: "NVIDIA CORP",
            updated: "2024-06-01T15:05:00Z",
            summary: "Item 2.02 Results of Operations",
            accession: "0001045810-24-000010",
          },
        ]),
        { status: 200 },
      ),
    );

    const source = new EdgarSignalSource(
      "edgar-1",
      JSON.stringify({
        cikWhitelist: ["320193"],
        itemCodeWhitelist: ["1.01"],
      }),
      cache,
    );
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    const result = await source.test();

    expect(result).toMatchObject({
      detected: 2,
      passed: 1,
      dropped: 1,
      errors: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceId: "edgar-1",
      sourceType: "edgar_8k",
      ticker: "AAPL",
      accessionNumber: "0000320193-24-000001",
      payloadJson: expect.objectContaining({
        itemCodes: ["1.01"],
        instrumentClass: "stock",
      }),
    });
    db.sqlite.close();
  });

  it("resolves tickers from SEC when cache miss", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          atomFeed([
            {
              cik: "320193",
              title: "Apple Inc.",
              updated: "2024-06-01T15:00:00Z",
              summary: "Item 8.01 Other Events",
              accession: "0000320193-24-000002",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tickers: ["AAPL"] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const source = new EdgarSignalSource("edgar-2", "{}", cache);
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    await source.test();

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("CIK0000320193.json"),
      ),
    ).toBe(true);
    expect(events[0]).toMatchObject({ ticker: "AAPL" });
    expect(cache.get("320193")).toBe("AAPL");
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.headers).toMatchObject({
        "User-Agent": expect.stringMatching(/^Exva\/[^ ]+ \(contact: .+\)$/),
      });
    }
    db.sqlite.close();
  });

  it("extracts and normalizes the CIK from the live accession-number feed shape", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);
    cache.upsert("1868419", "CYCU");
    fetchMock.mockResolvedValueOnce(
      new Response(
        `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
          <id>urn:tag:sec.gov,2008:accession-number=0001493152-26-034443</id>
          <title>8-K - Cycurion, Inc. (0001868419) (Filer)</title>
          <updated>2026-07-23T15:00:00Z</updated>
          <summary>Item 8.01 Other Events</summary>
          <link href="https://www.sec.gov/Archives/edgar/data/1868419/000149315226034443/form8-k.htm"/>
        </entry></feed>`,
        { status: 200 },
      ),
    );

    const source = new EdgarSignalSource("edgar-live-shape", "{}", cache);
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    const result = await source.test();

    expect(result).toMatchObject({
      detected: 1,
      passed: 1,
      dropped: 0,
      dropReasons: {},
    });
    expect(events[0]).toMatchObject({ ticker: "CYCU" });
    expect(cache.get("1868419")).toBe("CYCU");
    db.sqlite.close();
  });

  it("counts no-ticker drops by gate", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);
    cache.upsert("320193", null);
    fetchMock.mockResolvedValueOnce(
      new Response(
        atomFeed([
          {
            cik: "320193",
            title: "Apple Inc.",
            updated: "2024-06-01T15:00:00Z",
            summary: "Item 8.01 Other Events",
            accession: "0000320193-24-000004",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await new EdgarSignalSource(
      "edgar-no-ticker",
      "{}",
      cache,
    ).test();

    expect(result.dropReasons).toEqual({ no_ticker: 1 });
    expect(
      Object.values(result.dropReasons ?? {}).reduce((a, b) => a + b, 0),
    ).toBe(result.dropped);
    db.sqlite.close();
  });

  it("records poll errors when the feed request fails", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);

    fetchMock.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );

    const source = new EdgarSignalSource("edgar-3", "{}", cache);
    const result = await source.test();

    expect(result.errors[0]).toContain("503");
    expect(source.status).toBe("error");
    expect(source.lastError).toContain("503");
    db.sqlite.close();
  });

  it("fails the poll when a CIK lookup returns non-2xx (not a quiet drop)", async () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          atomFeed([
            {
              cik: "320193",
              title: "Apple Inc.",
              updated: "2024-06-01T15:00:00Z",
              summary: "Item 8.01 Other Events",
              accession: "0000320193-24-000003",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    const source = new EdgarSignalSource("edgar-4", "{}", cache);
    const result = await source.test();

    expect(result.errors[0]).toMatch(/CIK lookup status 503/i);
    expect(source.status).toBe("error");
    expect(cache.get("320193")).toBeUndefined();
    db.sqlite.close();
  });
});
