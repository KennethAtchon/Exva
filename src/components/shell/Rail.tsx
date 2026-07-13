import { Moon, Sun } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_ITEMS, NAV_PRIMARY_IDS, type PageKey } from "@/lib/nav";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const ExvaGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
    <path
      d="M11 2L20 7V15L11 20L2 15V7L11 2Z"
      className="fill-text1"
      opacity="0.9"
    />
    <path
      d="M11 6.5L15.5 9.25V14.5L11 17.25L6.5 14.5V9.25L11 6.5Z"
      className="fill-bg"
    />
  </svg>
);

type RailProps = {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  attentionCount: number;
  settingsAlarm: boolean;
  needsStrategyConfig: boolean;
};

export function Rail({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  attentionCount,
  settingsAlarm,
  needsStrategyConfig,
}: RailProps) {
  const { theme, toggleTheme } = useTheme();
  const docs = NAV_ITEMS.find((i) => i.id === "docs");
  if (!docs) {
    throw new Error("Docs nav item missing");
  }
  const DocsIcon = docs.icon;

  return (
    <aside
      className="flex h-full w-rail shrink-0 flex-col border-r border-border bg-surface"
      aria-label="Main navigation"
    >
      <div className="flex h-contextbar items-center justify-center border-b border-hairline">
        <ExvaGlyph />
        <span className="sr-only">exva</span>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1 py-2">
        {NAV_PRIMARY_IDS.map((id) => {
          const item = NAV_ITEMS.find((i) => i.id === id);
          if (!item) return null;
          const Icon = item.icon;
          const active = activePage === id;
          const showAttention = id === "dashboard" && attentionCount > 0;
          const showConfigHint = id === "sessions" && needsStrategyConfig;
          const showAlarm = id === "settings" && settingsAlarm;

          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (showAttention && onNavigateToAttentionSessions) {
                      onNavigate(id);
                    } else {
                      onNavigate(id);
                    }
                  }}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-sm transition-colors duration-hover",
                    active
                      ? "text-text1"
                      : "text-text3 hover:bg-surface2 hover:text-text2",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-sm bg-text1" />
                  )}
                  <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                  {showAttention && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`${attentionCount} need attention`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToAttentionSessions?.();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onNavigateToAttentionSessions?.();
                        }
                      }}
                      className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm border border-error-border bg-error-dim px-0.5 font-mono text-micro text-error"
                    >
                      {attentionCount}
                    </span>
                  )}
                  {(showConfigHint || showAlarm) && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-text1" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-sans text-caption">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex flex-col items-center gap-1 border-t border-hairline py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onNavigate("docs")}
              aria-label="Docs"
              aria-current={activePage === "docs" ? "page" : undefined}
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-sm transition-colors duration-hover",
                activePage === "docs"
                  ? "text-text1"
                  : "text-text3 hover:bg-surface2 hover:text-text2",
              )}
            >
              {activePage === "docs" && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-sm bg-text1" />
              )}
              <DocsIcon
                size={18}
                strokeWidth={activePage === "docs" ? 2.25 : 1.75}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-caption">
            Docs
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex h-10 w-10 items-center justify-center rounded-sm text-text3 transition-colors duration-hover hover:bg-surface2 hover:text-text2"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-caption">
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
