import { Card, SectionTitle } from "@/components/custom-ui";
import type { SessionRiskConfig } from "@/lib/types";

export const CostSummaryCard = ({
  riskConfig,
}: {
  riskConfig: SessionRiskConfig;
}) => (
  <Card>
    <SectionTitle>Cost / Latency Summary</SectionTitle>
    <div className="mt-3.5 flex flex-col gap-2">
      <div className="text-[12px] text-[var(--text2)]">
        Estimated parallel call count: {riskConfig.maxConcurrentTrades * 4}
      </div>
    </div>
  </Card>
);
