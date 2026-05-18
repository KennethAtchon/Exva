import type { CSSProperties, ReactNode } from "react";
import type { EventSourceType, LogLevel } from "@/lib/types";
import { Badge as UIBadge, Card as UICard, Separator } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";

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
  const tone: Record<BadgeVariant, string> = {
    default: "bg-muted text-muted-foreground border-transparent",
    success: "bg-emerald-500/15 text-emerald-400 border-transparent",
    danger: "bg-red-500/15 text-red-400 border-transparent",
    warn: "bg-amber-500/15 text-amber-300 border-transparent",
    blue: "bg-blue-500/15 text-blue-400 border-transparent",
    purple: "bg-violet-500/15 text-violet-400 border-transparent",
  };

  return (
    <UIBadge
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] font-mono font-medium tracking-wide",
        size === "sm" ? "px-[7px] py-[2px] text-[10px]" : "px-[9px] py-[3px] text-[11px]",
        tone[variant],
      )}
    >
      {children}
    </UIBadge>
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
  style: styleOverride,
}: {
  vertical?: boolean;
  style?: CSSProperties;
}) =>
  vertical ? (
    <Separator orientation="vertical" style={{ alignSelf: "stretch", flexShrink: 0, ...styleOverride }} />
  ) : (
    <Separator style={styleOverride} />
  );

const AGENT_LABEL: Record<string, { label: string; variant: BadgeVariant }> = {
  technical: { label: "tech", variant: "success" },
  fundamental: { label: "fund", variant: "danger" },
  review: { label: "review", variant: "blue" },
  decision: { label: "decide", variant: "purple" },
  selector: { label: "select", variant: "default" },
  analyst_technical: { label: "tech", variant: "success" },
  analyst_fundamental: { label: "fund", variant: "danger" },
  reviewer: { label: "review", variant: "blue" },
  decision_maker: { label: "decide", variant: "purple" },
  instrument_selector: { label: "select", variant: "default" },
};

export const AgentLabel = ({ type }: { type: EventSourceType }) => {
  const meta = AGENT_LABEL[type] ?? { label: type, variant: "default" as const };
  return (
    <Badge variant={meta.variant} size="sm">
      {meta.label}
    </Badge>
  );
};

export const LevelDot = ({ level }: { level: LogLevel }) => {
  const colorByLevel: Record<LogLevel, string> = {
    DEBUG: "#374151",
    INFO: "#60a5fa",
    WARN: "#fbbf24",
    ERROR: "#f87171",
  };
  return <Dot color={colorByLevel[level] ?? "#374151"} size={6} />;
};

export const PageShell = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-1 flex-col gap-7 overflow-auto px-9 py-8">{children}</div>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="m-0 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{children}</h2>
);

export const Card = ({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  accent?: boolean;
}) => (
  <UICard className={cn("rounded-[14px] border border-border bg-card px-6 py-[22px]", accent && "border-primary/35")} style={style}>
    {children}
  </UICard>
);

type SelectOption = {
  value: string;
  label: string;
};

export const ShadcnSelect = ({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) => {
  const EMPTY_VALUE = "__empty_option__";
  const normalized = value === "" ? EMPTY_VALUE : value;
  return (
    <Select
      value={normalized}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || EMPTY_VALUE} value={option.value === "" ? EMPTY_VALUE : option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
