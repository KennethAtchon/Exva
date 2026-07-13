import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
// HubEmptyState / HubQueryError share this module's DNA tokens.

/**
 * Shared instrument-panel DNA for the five operator hubs.
 * Tokens only — never invent hex. One family, five surfaces.
 */

export function HubFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--accent)] opacity-40"
      />
      {children}
    </div>
  );
}

export function HubHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  help,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-7 pb-4 pt-5">
      <div className="min-w-0">
        <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text3)]">
          {eyebrow}
        </div>
        <h1 className="m-0 font-sans text-[22px] font-semibold tracking-[-0.02em] text-[var(--text1)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 mb-0 max-w-[560px] text-[13px] leading-[1.45] text-[var(--text2)]">
            {subtitle}
          </p>
        ) : null}
        {help ? <div className="mt-2">{help}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>
      ) : null}
    </header>
  );
}

export type HubTab<T extends string> = {
  id: T;
  label: string;
  badge?: number | string | null;
  hint?: string;
};

export function HubTabBar<T extends string>({
  tabs,
  active,
  onChange,
  "aria-label": ariaLabel = "Hub sections",
}: {
  tabs: HubTab<T>[];
  active: T;
  onChange: (id: T) => void;
  "aria-label"?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-5"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            title={tab.hint}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-1.5 border-none bg-transparent px-3.5 font-sans text-[13px] transition-colors",
              isActive
                ? "font-medium text-[var(--text1)]"
                : "font-normal text-[var(--text2)] hover:text-[var(--text1)]",
            )}
          >
            {tab.label}
            {tab.badge != null && tab.badge !== 0 && tab.badge !== "" ? (
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full border border-error-border bg-error-dim px-1 font-mono text-[10px] font-bold text-error">
                {tab.badge}
              </span>
            ) : null}
            {isActive ? (
              <span className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-t-[2px] bg-[var(--accent)]" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function HubBody({
  children,
  className,
  scroll = true,
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        scroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function HubPane({
  children,
  className,
  title,
  eyebrow,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h2 className="m-0 truncate text-[13px] font-semibold text-[var(--text1)]">
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function HubSplit({
  left,
  right,
  leftWidth = "42%",
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("grid h-full min-h-0 flex-1 gap-3 p-4", className)}
      style={{
        gridTemplateColumns: `minmax(280px, ${leftWidth}) minmax(0, 1fr)`,
      }}
    >
      {left}
      {right}
    </div>
  );
}

export function HubMetricStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: ReactNode;
    sub?: ReactNode;
    tone?: "default" | "pos" | "neg" | "warn";
  }>;
}) {
  return (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)]">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "flex min-w-[120px] flex-1 flex-col gap-1 px-5 py-3.5",
            i > 0 && "border-l border-[var(--border)]",
          )}
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">
            {item.label}
          </div>
          <div
            className={cn(
              "font-mono text-[22px] font-bold leading-none tracking-tight",
              item.tone === "pos" && "text-success",
              item.tone === "neg" && "text-error",
              item.tone === "warn" && "text-warning",
              (!item.tone || item.tone === "default") && "text-[var(--text1)]",
            )}
          >
            {item.value}
          </div>
          {item.sub ? (
            <div className="text-[12px] text-[var(--text3)]">{item.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function HubStatusStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    ok?: boolean;
  }>;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] bg-[var(--surface)] px-7 py-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
        Supervisor
      </span>
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text2)]"
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              item.ok === false ? "bg-error" : "bg-success",
            )}
          />
          <span className="text-[var(--text3)]">{item.label}</span>
          <span className="font-mono text-[var(--text1)]">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Actionable TanStack Query / IPC failure — never leave a blank panel. */
export function HubQueryError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "m-4 rounded-lg border border-error-border bg-error-dim px-3.5 py-3 text-[13px] text-error",
        className,
      )}
    >
      <div className="font-medium">Could not load this panel</div>
      <p className="mt-1 mb-0 whitespace-pre-wrap text-[12px] leading-relaxed opacity-90">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2.5 cursor-pointer rounded-[7px] border border-error-border bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-error"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Designed empty — title + pointer to the action that fills the hub. */
export function HubEmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-2 text-[15px] font-semibold text-[var(--text1)]">
        {title}
      </div>
      {body ? (
        <p className="mx-auto mb-0 max-w-[420px] text-[13px] leading-relaxed text-[var(--text2)]">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
