import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

/**
 * Shared hub DNA — Terminal Ledger tokens only.
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
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-bg",
        className,
      )}
    >
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
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-4 pt-5">
      <div className="min-w-0">
        <div className="mb-1 font-mono text-micro uppercase tracking-wider text-text3">
          {eyebrow}
        </div>
        <h1 className="m-0 font-sans text-title text-text1">{title}</h1>
        {subtitle ? (
          <p className="mt-1 mb-0 max-w-xl font-sans text-body text-text2">
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
      className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-hairline bg-surface px-4"
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
              "relative flex h-9 shrink-0 items-center gap-1.5 border-none bg-transparent px-3 font-sans text-label transition-colors duration-hover",
              isActive ? "text-text1" : "text-text2 hover:text-text1",
            )}
          >
            {tab.label}
            {tab.badge != null && tab.badge !== 0 && tab.badge !== "" ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-error-border bg-error-dim px-1 font-mono text-micro font-bold text-error">
                {tab.badge}
              </span>
            ) : null}
            {isActive ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 bg-text1" />
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
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="font-mono text-micro uppercase tracking-wider text-text3">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h2 className="m-0 truncate font-sans text-head text-text1">
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
      className={cn("grid h-full min-h-0 flex-1 gap-3 p-6", className)}
      style={{
        gridTemplateColumns: `minmax(280px, ${leftWidth}) minmax(0, 1fr)`,
      }}
    >
      {left}
      {right}
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-6 py-2">
      <span className="font-mono text-micro uppercase tracking-wider text-text3">
        Supervisor
      </span>
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 font-sans text-caption text-text2"
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              item.ok === false ? "bg-error" : "bg-success",
            )}
          />
          <span className="text-text3">{item.label}</span>
          <span className="font-mono text-data text-text1">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

export function HubSideNav<T extends string>({
  items,
  active,
  onChange,
  "aria-label": ariaLabel = "Sections",
}: {
  items: HubTab<T>[];
  active: T;
  onChange: (id: T) => void;
  "aria-label"?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border px-3 py-4"
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative flex items-center gap-2 rounded-sm border-none px-3 py-2 text-left font-sans text-label transition-colors duration-hover",
              isActive
                ? "bg-surface2 text-text1"
                : "bg-transparent text-text2 hover:bg-surface2 hover:text-text1",
            )}
          >
            {isActive ? (
              <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-primary" />
            ) : null}
            <span className="min-w-0 flex-1 pl-1">{item.label}</span>
            {item.badge != null && item.badge !== 0 && item.badge !== "" ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-error-border bg-error-dim px-1 font-mono text-micro font-bold text-error">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

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
        "m-4 rounded-sm border border-error-border bg-error-dim px-3.5 py-3 font-sans text-body text-error",
        className,
      )}
    >
      <div className="font-medium">Could not load this panel</div>
      <p className="mt-1 mb-0 whitespace-pre-wrap text-caption leading-relaxed opacity-90">
        {message}
      </p>
      {onRetry ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onRetry}
          className="mt-2.5"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

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
    <EmptyState
      centered
      title={title}
      message={body}
      action={action}
      className={className}
    />
  );
}
