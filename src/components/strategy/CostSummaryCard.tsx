import { Card, SectionTitle } from "@/components/atoms";
import type { AgentRole, SessionStrategy } from "@/lib/types";

export const CostSummaryCard = ({
  strategy,
  roleProviders,
}: {
  strategy: SessionStrategy;
  roleProviders: Array<{ role: AgentRole; providerLabel: string; modelId: string }>;
}) => {
  const providerCounts = roleProviders.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.providerLabel] = (accumulator[entry.providerLabel] ?? 0) + 1;
    return accumulator;
  }, {});
  const duplicateProviders = Object.entries(providerCounts).filter(([, count]) => count > 1);

  return (
    <Card>
      <SectionTitle>Cost / Latency Summary</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text2)" }}>
          Estimated parallel call count: {strategy.maxConcurrentTrades * 4}
        </div>
        {roleProviders.map((entry) => (
          <div key={entry.role} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
            <span style={{ color: "var(--text3)" }}>{entry.role}</span>
            <span style={{ color: "var(--text2)", textAlign: "right" }}>
              {entry.providerLabel || "Unassigned"} {entry.modelId ? `· ${entry.modelId}` : ""}
            </span>
          </div>
        ))}
        {duplicateProviders.length > 0 && (
          <div style={{ marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(251,191,36,0.24)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12 }}>
            {duplicateProviders.map(([providerLabel, count]) => `${count} roles use ${providerLabel}`).join("; ")} — API rate limits may apply.
          </div>
        )}
      </div>
    </Card>
  );
};
