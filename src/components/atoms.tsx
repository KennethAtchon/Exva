import type { CSSProperties, ReactNode } from "react";
import type { AgentRole, EventSourceType, LogLevel } from "@/lib/types";

type BadgeVariant = "default" | "success" | "danger" | "warn" | "blue" | "purple";

export const Badge = ({
  children,
  variant = "default",
  size = "md",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
}) => {
  const bg: Record<BadgeVariant, string> = {
    default: "var(--chip)",
    success: "rgba(52,211,153,0.12)",
    danger: "rgba(248,113,113,0.12)",
    warn: "rgba(251,191,36,0.12)",
    blue: "rgba(96,165,250,0.12)",
    purple: "rgba(167,139,250,0.12)",
  };
  const fg: Record<BadgeVariant, string> = {
    default: "var(--text2)",
    success: "#34d399",
    danger: "#f87171",
    warn: "#fbbf24",
    blue: "#60a5fa",
    purple: "#a78bfa",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: bg[variant],
        color: fg[variant],
        borderRadius: 5,
        padding: size === "sm" ? "2px 7px" : "3px 9px",
        fontSize: size === "sm" ? 10 : 11,
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        letterSpacing: "0.025em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};

export const Dot = ({
  color = "#556068",
  pulse = false,
  size = 7,
}: {
  color?: string;
  pulse?: boolean;
  size?: number;
}) => (
  <span
    style={{
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
      animation: pulse ? "pulse-dot 2s ease-in-out infinite" : "none",
    }}
  />
);

export const Divider = ({
  vertical,
  style: s,
}: {
  vertical?: boolean;
  style?: CSSProperties;
}) =>
  vertical ? (
    <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch", flexShrink: 0, ...s }} />
  ) : (
    <div style={{ height: 1, background: "var(--border)", ...s }} />
  );

const AGENT_LABEL: Record<AgentRole, { label: string; variant: BadgeVariant }> = {
  researcher_bull: { label: "bull", variant: "success" },
  researcher_bear: { label: "bear", variant: "danger" },
  reviewer: { label: "review", variant: "blue" },
  decision_maker: { label: "decide", variant: "purple" },
  instrument_selector: { label: "select", variant: "default" },
};

export const AgentLabel = ({ type }: { type: EventSourceType }) => {
  const m = AGENT_LABEL[type as AgentRole] ?? { label: type, variant: "default" as const };
  return (
    <Badge variant={m.variant} size="sm">
      {m.label}
    </Badge>
  );
};

export const LevelDot = ({ level }: { level: LogLevel }) => {
  const c: Record<LogLevel, string> = {
    DEBUG: "#374151",
    INFO: "#60a5fa",
    WARN: "#fbbf24",
    ERROR: "#f87171",
  };
  return <Dot color={c[level] ?? "#374151"} size={6} />;
};

export const PageShell = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      flex: 1,
      overflow: "auto",
      padding: "32px 36px",
      display: "flex",
      flexDirection: "column",
      gap: 28,
    }}
  >
    {children}
  </div>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2
    style={{
      fontSize: 11,
      fontWeight: 700,
      color: "var(--text3)",
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      margin: 0,
    }}
  >
    {children}
  </h2>
);

export const Card = ({
  children,
  style: s,
  accent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  accent?: boolean;
}) => (
  <div
    style={{
      background: "var(--surface)",
      border: `1px solid ${accent ? "var(--accent-dim)" : "var(--border)"}`,
      borderRadius: 14,
      padding: "22px 24px",
      ...s,
    }}
  >
    {children}
  </div>
);
