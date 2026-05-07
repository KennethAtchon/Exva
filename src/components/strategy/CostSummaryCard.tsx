import { Card, SectionTitle } from "@/components/custom-ui";
import type { AgentRole, SessionRiskConfig } from "@/lib/types";

export interface RoleProviderEntry {
  role: AgentRole;
  providerLabel: string;
  modelId: string;
  connected: boolean;
}

export const CostSummaryCard = ({
  riskConfig,
  roleProviders,
}: {
  riskConfig: SessionRiskConfig;
  roleProviders: RoleProviderEntry[];
}) => {
  const unconfigured = roleProviders.filter((entry) => !entry.connected);
  const configured = roleProviders.filter((entry) => entry.connected);

  const providerCounts = configured.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.providerLabel] = (acc[entry.providerLabel] ?? 0) + 1;
    return acc;
  }, {});
  const duplicateProviders = Object.entries(providerCounts).filter(([, count]) => count > 1);

  return (
    <Card>
      <SectionTitle>Cost / Latency Summary</SectionTitle>

      {unconfigured.length > 0 && (
        <div style={warningBannerStyle}>
          <strong style={{ display: "block", marginBottom: 4 }}>
            {unconfigured.length} role{unconfigured.length > 1 ? "s" : ""} not connected
          </strong>
          {unconfigured.map((entry) => entry.role.replaceAll("_", " ")).join(", ")} — select a
          provider account in each role tab before starting.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <div style={{ fontSize: 12, color: "var(--text2)" }}>
          Estimated parallel call count: {riskConfig.maxConcurrentTrades * 4}
        </div>
        {roleProviders.map((entry) => (
          <div
            key={entry.role}
            style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}
          >
            <span style={{ color: entry.connected ? "var(--text3)" : "var(--text3)", opacity: entry.connected ? 1 : 0.7 }}>
              {entry.role.replaceAll("_", " ")}
            </span>
            <span
              style={{
                color: entry.connected ? "var(--text2)" : "#f87171",
                textAlign: "right",
                fontWeight: entry.connected ? 400 : 500,
              }}
            >
              {entry.connected
                ? `${entry.providerLabel} · ${entry.modelId}`
                : "Not connected"}
            </span>
          </div>
        ))}
        {duplicateProviders.length > 0 && (
          <div style={rateLimitWarningStyle}>
            {duplicateProviders
              .map(([providerLabel, count]) => `${count} roles use ${providerLabel}`)
              .join("; ")}{" "}
            — API rate limits may apply.
          </div>
        )}
      </div>
    </Card>
  );
};

const warningBannerStyle = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(248,113,113,0.28)",
  background: "rgba(248,113,113,0.08)",
  color: "#fca5a5",
  fontSize: 12,
  lineHeight: 1.55,
} as const;

const rateLimitWarningStyle = {
  marginTop: 4,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(251,191,36,0.24)",
  background: "rgba(251,191,36,0.08)",
  color: "#fbbf24",
  fontSize: 12,
} as const;
