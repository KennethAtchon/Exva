import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatPnl, formatCurrency } from "@/lib/format";

/** Compact uppercase section label (formerly custom-ui `SectionTitle`). */
export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "m-0 font-mono text-micro font-medium uppercase tracking-wider text-text3",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 font-mono text-micro uppercase tracking-wider text-text3">
            {eyebrow}
          </div>
        ) : null}
        <div className="font-sans text-head text-text1">{title}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaTone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: "default" | "success" | "error";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 font-mono text-micro uppercase tracking-wider text-text3">
        {label}
      </div>
      <div className="font-mono text-stat tabular-nums text-text1">{value}</div>
      {delta != null ? (
        <div
          className={cn(
            "mt-1 font-mono text-caption",
            deltaTone === "success" && "text-success",
            deltaTone === "error" && "text-error",
            deltaTone === "default" && "text-text2",
          )}
        >
          {delta}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  actionLabel,
  onAction,
  className,
  centered = false,
}: {
  icon?: ReactNode;
  title?: string;
  message?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  /** Centered hub-style empty state (no card border). */
  centered?: boolean;
}) {
  const actionNode =
    action ??
    (actionLabel && onAction ? (
      <Button size="sm" variant="secondary" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : null);

  return (
    <div
      className={cn(
        centered
          ? "flex flex-col items-center justify-center px-6 py-12 text-center"
          : "flex flex-col items-start gap-3 rounded-sm border border-border bg-surface p-6",
        className,
      )}
    >
      {icon ? <div className="text-text3">{icon}</div> : null}
      {title ? (
        <div
          className={cn(
            "font-sans text-head text-text1",
            centered ? "mb-2" : undefined,
          )}
        >
          {title}
        </div>
      ) : null}
      {message ? (
        <p
          className={cn(
            "max-w-md font-sans text-body text-text2",
            centered && "mx-auto mb-0 leading-relaxed",
          )}
        >
          {message}
        </p>
      ) : null}
      {actionNode ? (
        <div className={cn(centered && "mt-4")}>{actionNode}</div>
      ) : null}
    </div>
  );
}

const pnlVariants = cva("font-mono tabular-nums", {
  variants: {
    size: {
      body: "text-data",
      stat: "text-stat",
      hero: "text-hero",
    },
  },
  defaultVariants: { size: "body" },
});

export function PnL({
  value,
  size,
  className,
  showSign = true,
}: {
  value: number | null | undefined;
  size?: VariantProps<typeof pnlVariants>["size"];
  className?: string;
  showSign?: boolean;
} & VariantProps<typeof pnlVariants>) {
  if (value == null || Number.isNaN(value)) {
    return (
      <span className={cn(pnlVariants({ size }), "text-text3", className)}>
        —
      </span>
    );
  }
  const positive = value > 0;
  const negative = value < 0;
  const formatted = showSign
    ? formatPnl(value)
    : formatCurrency(Math.abs(value));
  return (
    <span
      className={cn(
        pnlVariants({ size }),
        positive && "text-success",
        negative && "text-error",
        !positive && !negative && "text-text2",
        className,
      )}
    >
      {formatted}
    </span>
  );
}
