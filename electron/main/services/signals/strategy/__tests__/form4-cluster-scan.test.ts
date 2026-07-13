/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  detectForm4Clusters,
  isOpenMarketBuyCode,
  parseForm4Xml,
} from "../../form4/form4-parser";
import { scanForm4Clusters } from "../form4-cluster-scan";

const SAMPLE_XML = `
<ownershipDocument>
  <issuerName>Acme Corp</issuerName>
  <issuerTradingSymbol>ACME</issuerTradingSymbol>
  <rptOwnerName>Jane Doe</rptOwnerName>
  <officerTitle>CEO</officerTitle>
  <isOfficer>1</isOfficer>
  <nonDerivativeTransaction>
    <transactionDate><value>2026-06-01</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>5000</value></transactionShares>
      <transactionPricePerShare><value>20</value></transactionPricePerShare>
    </transactionAmounts>
  </nonDerivativeTransaction>
</ownershipDocument>
`;

describe("Form 4 parser + cluster", () => {
  it("recognizes open-market buy code P", () => {
    expect(isOpenMarketBuyCode("P")).toBe(true);
    expect(isOpenMarketBuyCode("S")).toBe(false);
  });

  it("parses Form 4 XML into open-market buys", () => {
    const txs = parseForm4Xml(SAMPLE_XML, {
      accessionNumber: "000123",
      cik: "0001",
      filedAt: "2026-06-02T15:00:00.000Z",
      documentUrl: "https://sec.gov/Archives/000123",
    });
    expect(txs.length).toBeGreaterThanOrEqual(1);
    expect(txs[0]!.isOpenMarketBuy).toBe(true);
    expect(txs[0]!.ticker).toBe("ACME");
    expect(txs[0]!.totalValueUsd).toBe(100_000);
  });

  it("clusters multiple insiders buying within window", () => {
    const base = {
      accessionNumber: "a",
      cik: "1",
      ticker: "ACME",
      companyName: "Acme",
      role: "Officer",
      transactionCode: "P",
      shares: 1000,
      pricePerShare: 50,
      totalValueUsd: 50_000,
      isOpenMarketBuy: true,
      filedAt: "2026-06-05T00:00:00.000Z",
      transactionDate: "2026-06-04",
      documentUrl: null,
    };
    const clusters = detectForm4Clusters(
      [
        { ...base, insiderName: "A", accessionNumber: "a1" },
        {
          ...base,
          insiderName: "B",
          accessionNumber: "a2",
          filedAt: "2026-06-06T00:00:00.000Z",
        },
        {
          ...base,
          insiderName: "C",
          accessionNumber: "a3",
          filedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
      { minInsiders: 3, minTotalValueUsd: 100_000, windowDays: 7 },
      "2026-06-08T00:00:00.000Z",
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.insiderCount).toBe(3);
    const signals = scanForm4Clusters(
      [
        { ...base, insiderName: "A", accessionNumber: "a1" },
        { ...base, insiderName: "B", accessionNumber: "a2" },
        { ...base, insiderName: "C", accessionNumber: "a3" },
      ],
      { minInsiders: 3, minTotalValueUsd: 100_000, windowDays: 7 },
      "2026-06-08T00:00:00.000Z",
    );
    expect(signals[0]!.kind).toBe("filing");
    if (signals[0]!.kind !== "filing") throw new Error("unreachable");
    expect(signals[0]!.payload.form4?.insiderCount).toBe(3);
    expect(signals[0]!.dedupeKey).toContain("form=4");
  });
});
