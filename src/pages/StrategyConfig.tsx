import { useEffect, useState, type CSSProperties } from "react";
import { Card, PageShell, SectionTitle } from "@/components/atoms";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { api } from "@/lib/exva";
import { useConfigStore } from "@/store/configStore";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SessionConfig } from "@/lib/types";

const Slider = ({
  label, hint, value, min, max, step, format, onChange,
}: {
  label: string; hint?: string; value: number;
  min: number; max: number; step: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={cs.field}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div>
          <span style={cs.fieldLabel}>{label}</span>
          {hint && <span style={cs.hint}> — {hint}</span>}
        </div>
        <span style={cs.fieldVal}>{format ? format(value) : value}</span>
      </div>
      <div style={{ position: "relative", height: 4, background: "var(--surface3)", borderRadius: 2 }}>
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)", pointerEvents: "none" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: "-10px 0", opacity: 0, width: "100%", cursor: "pointer" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span style={cs.rangeHint}>{format ? format(min) : min}</span>
        <span style={cs.rangeHint}>{format ? format(max) : max}</span>
      </div>
    </div>
  );
};

const Segmented = <T extends string>({
  label, hint, value, options, onChange,
}: {
  label: string; hint?: string; value: T;
  options: { value: T; label: string }[]; onChange: (v: T) => void;
}) => (
  <div style={cs.field}>
    <div style={{ marginBottom: 10 }}>
      <span style={cs.fieldLabel}>{label}</span>
      {hint && <span style={cs.hint}> — {hint}</span>}
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{ ...cs.seg, ...(value === opt.value ? cs.segActive : {}) }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

const Toggle = ({
  label, hint, value, onChange,
}: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void;
}) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
    <div>
      <div style={cs.fieldLabel}>{label}</div>
      {hint && <div style={{ ...cs.hint, marginTop: 3, display: "block" }}>{hint}</div>}
    </div>
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: value ? "var(--accent)" : "var(--surface3)",
        cursor: "pointer", position: "relative",
        transition: "background 0.2s", flexShrink: 0, marginTop: 2,
      }}
    >
      <div
        style={{
          position: "absolute", top: 3, width: 18, height: 18,
          borderRadius: "50%", background: "#fff",
          transition: "left 0.2s", left: value ? 21 : 3,
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  </div>
);

export const StrategyConfig = () => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);
  const status = useSessionStore((state) => state.status);
  const cfg = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const patch = useConfigStore((s) => s.patch);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (viewMode === "global") return;
    api.getStrategyConfig().then(setConfig).catch(() => {});
  }, [setConfig, viewMode]);

  if (viewMode === "global") {
    return (
      <PageShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>Strategy</h1>
            <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>Choose a session to edit strategy settings.</p>
          </div>
          <WorkspaceContextChip
            onSwitchSession={async (id) => {
              await api.focusSession(id);
              await loadWorkspaceView();
            }}
            onGoGlobal={async () => {
              await api.goGlobal();
              setViewMode("global", null);
            }}
          />
        </div>
        <Card>
          <SectionTitle>Global Mode</SectionTitle>
          <p style={{ color: "var(--text3)", fontSize: 13, marginTop: 12 }}>Strategy is not editable in global mode. Choose a focused session from the context chip.</p>
        </Card>
      </PageShell>
    );
  }

  const isLocked = status === "active" || status === "paused";

  const save = async () => {
    if (isLocked) return;
    setSaving(true);
    try {
      await api.saveStrategyConfig(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const rrRatio = (cfg.take_profit_pct / cfg.stop_loss_pct).toFixed(1);
  const worstCase = ((cfg.max_position_usd * cfg.stop_loss_pct) / 100).toFixed(2);
  const bestCase = ((cfg.max_position_usd * cfg.take_profit_pct) / 100).toFixed(2);

  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) => {
    patch(k, v);
    setSaved(false);
  };

  return (
    <PageShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>Strategy</h1>
          <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>Trading parameters and risk controls</p>
        </div>
        <WorkspaceContextChip
          onSwitchSession={async (id) => {
            await api.focusSession(id);
            await loadWorkspaceView();
          }}
          onGoGlobal={async () => {
            await api.goGlobal();
            setViewMode("global", null);
          }}
        />
      </div>
      {isLocked && (
        <div style={{ padding: "10px 14px", border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", borderRadius: 10, fontSize: 12 }}>
          This session is locked while active or paused. Configuration is read-only until the session stops.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div />
        <button
          disabled={saving || isLocked}
          onClick={save}
          style={{
            padding: "9px 22px",
            background: saved ? "#34d399" : "var(--accent)",
            border: "none", borderRadius: 9,
            color: saved ? "#0a1a12" : "#fff",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
            fontFamily: "var(--font-sans)", transition: "all 0.2s",
          }}
        >
          {saved ? "✓ Saved" : saving ? "Saving…" : "Save Config"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <SectionTitle>Mode</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 18 }}>
              <Segmented
                label="Strategy" value={cfg.strategy}
                options={[
                  { value: "passive_income", label: "Passive Income" },
                  { value: "growth", label: "Growth" },
                  { value: "conservative", label: "Conservative" },
                ]}
                onChange={(v) => set("strategy", v)}
              />
              <Segmented
                label="Research Depth" hint="affects latency and AI cost"
                value={cfg.research_depth}
                options={[
                  { value: "light", label: "Light" },
                  { value: "balanced", label: "Balanced" },
                  { value: "deep", label: "Deep" },
                ]}
                onChange={(v) => set("research_depth", v)}
              />
              <Toggle
                label="Human Approval Required"
                hint="Pause before each trade — you review and confirm in-app"
                value={cfg.human_approval_required}
                onChange={(v) => set("human_approval_required", v)}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle>Position Sizing</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 18 }}>
              <Slider label="Max Position Size" value={cfg.max_position_usd}
                min={100} max={2000} step={50} format={(v) => `$${v}`}
                onChange={(v) => set("max_position_usd", v)} />
              <Slider label="Max Concurrent Trades" value={cfg.max_concurrent_trades}
                min={1} max={10} step={1}
                onChange={(v) => set("max_concurrent_trades", v)} />
            </div>
          </Card>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <SectionTitle>Trade Risk</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 18 }}>
              <Slider label="Stop Loss" value={cfg.stop_loss_pct}
                min={0.5} max={10} step={0.5} format={(v) => `${v}%`}
                onChange={(v) => set("stop_loss_pct", v)} />
              <Slider label="Take Profit" value={cfg.take_profit_pct}
                min={1} max={20} step={0.5} format={(v) => `${v}%`}
                onChange={(v) => set("take_profit_pct", v)} />
              <div style={{ display: "flex", gap: 14 }}>
                {(
                  [
                    ["Risk / Reward", `1 : ${rrRatio}`],
                    ["Max loss/trade", `-$${worstCase}`],
                    ["Max gain/trade", `+$${bestCase}`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} style={{ flex: 1, background: "var(--surface2)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{k}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--text1)" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Session Limits</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 18 }}>
              <Slider label="Daily Loss Limit" value={cfg.daily_loss_limit_usd}
                min={50} max={1000} step={50} format={(v) => `$${v}`}
                onChange={(v) => set("daily_loss_limit_usd", v)} />
              <Slider label="Profit Target" value={cfg.profit_target_usd}
                min={100} max={5000} step={100} format={(v) => `$${v}`}
                onChange={(v) => set("profit_target_usd", v)} />
              <Slider label="Max API Spend / Day" value={cfg.max_api_spend_usd}
                min={1} max={25} step={0.5} format={(v) => `$${v}`}
                onChange={(v) => set("max_api_spend_usd", v)} />
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
};

const cs: Record<string, CSSProperties> = {
  field: { display: "flex", flexDirection: "column" },
  fieldLabel: { fontSize: 14, fontWeight: 500, color: "var(--text1)" },
  hint: { fontSize: 12, color: "var(--text3)" },
  fieldVal: { fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "var(--accent)" },
  rangeHint: { fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" },
  seg: {
    flex: 1, padding: "7px 10px", fontSize: 13, borderRadius: 8,
    cursor: "pointer", background: "var(--surface2)",
    border: "1px solid var(--border)", color: "var(--text2)",
    fontFamily: "var(--font-sans)", transition: "all 0.1s",
  },
  segActive: {
    background: "rgba(96,165,250,0.1)",
    borderColor: "rgba(96,165,250,0.3)",
    color: "#60a5fa", fontWeight: 600,
  },
};
