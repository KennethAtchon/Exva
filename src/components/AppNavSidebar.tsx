import { Fragment } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, HelpTooltip } from "@/components/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_ITEMS, type PageKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ExvaLogo = ({ compact }: { compact?: boolean }) => (
  <div
    className={cn(
      "flex shrink-0 items-center gap-[9px]",
      compact ? "justify-center" : "px-1",
    )}
  >
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path
        d="M11 2L20 7V15L11 20L2 15V7L11 2Z"
        fill="var(--accent)"
        opacity="0.9"
      />
      <path
        d="M11 6.5L15.5 9.25V14.5L11 17.25L6.5 14.5V9.25L11 6.5Z"
        fill="var(--bg)"
      />
    </svg>
    {!compact && (
      <span className="font-mono text-[17px] font-bold tracking-[0.08em] text-[var(--text1)]">
        exva
      </span>
    )}
  </div>
);

type Props = {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  attentionCount: number;
  needsStrategyConfig: boolean;
  isGlobal: boolean;
  sessionName: string;
};

export const AppNavSidebar = ({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  collapsed,
  onToggleCollapse,
  attentionCount,
  needsStrategyConfig,
  isGlobal,
  sessionName,
}: Props) => (
  <aside
    className={cn(
      "flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200 ease-out",
      collapsed ? "w-[52px]" : "w-[220px]",
    )}
    aria-label="Main navigation"
  >
    <div
      className={cn(
        "flex h-[58px] shrink-0 items-center border-b border-[var(--border)]",
        collapsed ? "justify-center px-2" : "justify-between px-4",
      )}
    >
      <ExvaLogo compact={collapsed} />
      {!collapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text3)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text1)]"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft size={16} />
        </button>
      )}
    </div>

    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => {
        const active = activePage === item.id;
        const isStrategy = item.id === "strategy";
        const isSessions = item.id === "sessions";
        const Icon = item.icon;

        const button = (
          <div className="flex items-center gap-1">
            <Button
              onClick={() => onNavigate(item.id)}
              variant="ghost"
              className={cn(
                "relative h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 font-sans text-[13px] font-normal text-[var(--text2)] hover:bg-[var(--surface2)] hover:text-[var(--text1)]",
                collapsed && "justify-center px-0",
                active &&
                  "bg-[var(--surface2)] font-medium text-[var(--text1)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-r before:bg-[var(--accent)]",
                isStrategy && needsStrategyConfig && "text-[var(--accent)]",
              )}
            >
              <Icon size={16} className="shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && isSessions && attentionCount > 0 && (
                <span
                  className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-error-border bg-error-dim px-[5px] font-mono text-[12px] font-bold text-error"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNavigateToAttentionSessions?.();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onNavigateToAttentionSessions?.();
                    }
                  }}
                >
                  {attentionCount}
                </span>
              )}
              {!collapsed && isStrategy && needsStrategyConfig && (
                <span className="ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              )}
              {collapsed && isSessions && attentionCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error" />
              )}
            </Button>
            {!collapsed && isSessions && attentionCount > 0 ? (
              <HelpTooltip
                topic="Sessions needing attention"
                body="Shows how many sessions currently need intervention."
              />
            ) : null}
            {!collapsed && isStrategy && !isGlobal ? (
              <HelpTooltip
                topic="Strategy page"
                body={`Configure AI phases, risk limits, and strategy for ${sessionName}.`}
              />
            ) : null}
            {!collapsed && isStrategy && needsStrategyConfig ? (
              <HelpTooltip
                topic="Strategy configuration status"
                body="The focused session still has missing strategy configuration."
              />
            ) : null}
          </div>
        );

        if (!collapsed) {
          return <Fragment key={item.id}>{button}</Fragment>;
        }

        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>

    {collapsed && (
      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-9 w-full items-center justify-center rounded-lg text-[var(--text3)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text1)]"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    )}
  </aside>
);
