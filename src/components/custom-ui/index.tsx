import type { CSSProperties, ReactNode } from "react";
import type { EventSourceType } from "@/lib/types";
import {
  Badge as UIBadge,
  Card as UICard,
  SectionTitle as UISectionTitle,
} from "@/components/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "danger"
  | "warn"
  | "blue"
  | "purple";

const badgeTone = cva(
  "inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border font-mono text-micro font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface3 text-text3",
        success: "border-success-border bg-success-dim text-success",
        danger: "border-error-border bg-error-dim text-error",
        warn: "border-warning-border bg-warning-dim text-warning",
        blue: "border-info-border bg-info-dim text-info",
        purple: "border-market-border bg-market-dim text-market",
      },
      size: {
        sm: "px-1.5 py-0.5",
        md: "px-2 py-0.5",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

/** App semantic badge — wraps `ui/Badge` with status tones. */
export const Badge = ({
  children,
  variant = "default",
  size = "md",
  title,
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  title?: string;
  className?: string;
} & VariantProps<typeof badgeTone>) => (
  <UIBadge
    title={title}
    className={cn(badgeTone({ variant, size }), className)}
  >
    <span className="truncate">{children}</span>
  </UIBadge>
);

export const Dot = ({
  color = "var(--text3)",
  pulse = false,
  size = 7,
}: {
  color?: string;
  pulse?: boolean;
  size?: number;
}) => (
  <span
    className="inline-block shrink-0 rounded-full"
    style={{
      width: size,
      height: size,
      background: color,
      animation: pulse ? "pulse-dot 2s ease-in-out infinite" : "none",
    }}
  />
);

export const AGENT_LABEL: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  technical: { label: "tech", variant: "success" },
  fundamental: { label: "fund", variant: "danger" },
  review: { label: "review", variant: "blue" },
  decision: { label: "decide", variant: "purple" },
  selector: { label: "select", variant: "default" },
};

export const AgentLabel = ({ type }: { type: EventSourceType }) => {
  const meta = AGENT_LABEL[type] ?? {
    label: type,
    variant: "default" as const,
  };
  return (
    <Badge variant={meta.variant} size="sm">
      {meta.label}
    </Badge>
  );
};

/** Re-export canonical section label from `ui/primitives`. */
export const SectionTitle = UISectionTitle;

/** Card wrapper preserving accent/padding convenience used by panels. */
export const Card = ({
  children,
  style,
  className,
  accent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  accent?: boolean;
}) => (
  <UICard
    className={cn(
      "rounded-sm border border-border bg-surface px-4 py-4",
      accent && "border-text1/35",
      className,
    )}
    style={style}
  >
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
      <SelectTrigger
        className={cn(
          "h-8 border-hairline bg-surface2 text-body text-text1",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_VALUE}
            value={option.value === "" ? EMPTY_VALUE : option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
