import { Card, SectionTitle } from "@/components/custom-ui";
import type { SessionRiskConfig } from "@/lib/types";

export const CostSummaryCard = ({
  riskConfig,
}: {
  riskConfig: SessionRiskConfig;
}) => (
  <Card>
    <SectionTitle>Cost / Latency Summary</SectionTitle>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 14,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text2)" }}>
        Estimated parallel call count: {riskConfig.maxConcurrentTrades * 4}
      </div>
    </div>
  </Card>
);
