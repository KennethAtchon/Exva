import type { SessionSummary } from "@/lib/exva";

export const SessionDetailDrawer = ({ session, onClose }: { session: SessionSummary | null; onClose: () => void }) => {
  if (!session) return null;

  return (
    // TODO(phase-04): Expand this into the full detail drawer from the plan with
    // task definition, instrument scope, risk limits, assigned brokers, AI role summary,
    // and recent activity timeline.
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 35 }} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 380, height: "100%", background: "var(--surface)", borderLeft: "1px solid var(--border)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{session.name}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <section>
            <div style={labelStyle}>Objective</div>
            <div style={valueStyle}>{session.objective}</div>
          </section>
          <section>
            <div style={labelStyle}>Instrument Scope</div>
            <div style={valueStyle}>{session.instrumentScope}</div>
          </section>
          <section>
            <div style={labelStyle}>Execution</div>
            <div style={valueStyle}>{session.executionMode}</div>
          </section>
          <section>
            <div style={labelStyle}>Capital Limit</div>
            <div style={valueStyle}>${session.capitalLimitUsd.toLocaleString()}</div>
          </section>
          <section>
            <div style={labelStyle}>Brokers</div>
            <div style={valueStyle}>{session.brokerCount}</div>
          </section>
          <section>
            <div style={labelStyle}>Open Trades</div>
            <div style={valueStyle}>{session.openTradeCount}</div>
          </section>
        </div>
      </div>
    </div>
  );
};

const labelStyle = { fontSize: 11, color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 } as const;
const valueStyle = { fontSize: 14, color: "var(--text1)" } as const;
