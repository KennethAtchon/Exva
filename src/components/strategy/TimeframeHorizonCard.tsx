import { Card, SectionTitle } from "@/components/atoms";
import type { SessionStrategy } from "@/lib/types";
import { HOLDING_STYLES, TRADING_TIMEFRAMES, timeframeHoldMismatchWarning } from "../../../electron/shared/domain";

type Props = {
  strategy: SessionStrategy;
  disabled: boolean;
  onChange: (patch: Partial<SessionStrategy>) => void;
};

export const TimeframeHorizonCard = ({ strategy, disabled, onChange }: Props) => {
  const mismatch = timeframeHoldMismatchWarning(strategy);

  return (
    <Card>
      <SectionTitle>Timeframe &amp; holding horizon</SectionTitle>
      <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
        Bar size agents use for thesis and risk. Optional hold targets align approvals and AI context with how long
        you intend to keep positions.
      </p>
      <div style={formGridStyle}>
        <Field label="Primary trading timeframe">
          <select
            value={strategy.primaryTradingTimeframe}
            onChange={(event) =>
              onChange({ primaryTradingTimeframe: event.target.value as SessionStrategy["primaryTradingTimeframe"] })
            }
            disabled={disabled}
            style={inputStyle}
          >
            {TRADING_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Holding style">
          <select
            value={strategy.holdingStyle}
            onChange={(event) => onChange({ holdingStyle: event.target.value as SessionStrategy["holdingStyle"] })}
            disabled={disabled}
            style={inputStyle}
          >
            {HOLDING_STYLES.map((style) => (
              <option key={style} value={style}>
                {holdingStyleLabel(style)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target hold (days, optional)">
          <input
            type="number"
            min={0}
            step={1}
            value={strategy.targetHoldDays ?? ""}
            placeholder="—"
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ targetHoldDays: raw === "" ? null : Number(raw) });
            }}
            disabled={disabled}
            style={inputStyle}
          />
        </Field>
        <Field label="Max hold (days, optional)">
          <input
            type="number"
            min={0}
            step={1}
            value={strategy.maxHoldDays ?? ""}
            placeholder="—"
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ maxHoldDays: raw === "" ? null : Number(raw) });
            }}
            disabled={disabled}
            style={inputStyle}
          />
        </Field>
        <Field label="Timeframe notes">
          <textarea
            value={strategy.timeframeNotes}
            onChange={(event) => onChange({ timeframeNotes: event.target.value })}
            disabled={disabled}
            rows={3}
            placeholder="e.g. No new entries after Friday 12 ET"
            style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
          />
        </Field>
      </div>
      {mismatch ? (
        <p style={{ marginTop: 12, fontSize: 12, color: "#fbbf24", lineHeight: 1.45 }}>{mismatch}</p>
      ) : null}
    </Card>
  );
};

function holdingStyleLabel(style: SessionStrategy["holdingStyle"]): string {
  switch (style) {
    case "intraday_flat":
      return "Intraday (flat by default)";
    case "multi_day_swing":
      return "Multi-day swing";
    case "weeks_position":
      return "Weeks+ position";
    default:
      return "Custom (see notes)";
  }
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    {children}
  </div>
);

const formGridStyle = { display: "grid", gap: 14, marginTop: 16 } as const;
const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
} as const;
