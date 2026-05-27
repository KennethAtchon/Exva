import { Card, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import type { SessionTimeframeConfig } from "@/lib/types";
import {
  HOLDING_STYLES,
  TRADING_TIMEFRAMES,
  timeframeConfigHoldMismatchWarning,
} from "../../../electron/shared/domain";

type Props = {
  timeframe: SessionTimeframeConfig;
  disabled: boolean;
  onChange: (patch: Partial<SessionTimeframeConfig>) => void;
};

export const TimeframeHorizonCard = ({
  timeframe,
  disabled,
  onChange,
}: Props) => {
  const mismatch = timeframeConfigHoldMismatchWarning(timeframe);

  return (
    <Card>
      <SectionTitle>Timeframe &amp; holding horizon</SectionTitle>
      <p className="mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        Bar size agents use for thesis and risk. Optional hold targets align
        approvals and AI context with how long you intend to keep positions.
      </p>
      <div className="mt-4 grid gap-3.5">
        <Field label="Primary trading timeframe">
          <ShadcnSelect
            value={timeframe.primaryTradingTimeframe}
            onValueChange={(value) =>
              onChange({
                primaryTradingTimeframe:
                  value as SessionTimeframeConfig["primaryTradingTimeframe"],
              })
            }
            disabled={disabled}
            options={TRADING_TIMEFRAMES.map((timeframe) => ({
              value: timeframe,
              label: timeframe,
            }))}
          />
        </Field>
        <Field label="Holding style">
          <ShadcnSelect
            value={timeframe.holdingStyle}
            onValueChange={(value) =>
              onChange({
                holdingStyle: value as SessionTimeframeConfig["holdingStyle"],
              })
            }
            disabled={disabled}
            options={HOLDING_STYLES.map((style) => ({
              value: style,
              label: holdingStyleLabel(style),
            }))}
          />
        </Field>
        <Field label="Target hold (days, optional)">
          <input
            type="number"
            min={0}
            step={1}
            value={timeframe.targetHoldDays ?? ""}
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
            value={timeframe.maxHoldDays ?? ""}
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
            value={timeframe.timeframeNotes}
            onChange={(event) =>
              onChange({ timeframeNotes: event.target.value })
            }
            disabled={disabled}
            rows={3}
            placeholder="e.g. No new entries after Friday 12 ET"
            style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
          />
        </Field>
      </div>
      {mismatch ? (
        <p className="mt-3 text-[12px] leading-[1.45] text-warning">
          {mismatch}
        </p>
      ) : null}
    </Card>
  );
};

function holdingStyleLabel(
  style: SessionTimeframeConfig["holdingStyle"],
): string {
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

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="grid gap-1.5">
    <div className="text-[12px] text-[var(--text3)]">{label}</div>
    {children}
  </div>
);
const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
} as const;
