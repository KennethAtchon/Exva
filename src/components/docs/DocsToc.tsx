import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useActiveHeading, useDocHeadings, useDocsNavigation } from "./context";

export function DocsToc() {
  const headings = useDocHeadings();
  const { navigate, slug } = useDocsNavigation();
  const [activeId, setActiveId] = useActiveHeading(headings);

  const scrollToHeading = useCallback(
    (id: string) => {
      navigate(slug, id);
      setActiveId(id);
    },
    [navigate, slug, setActiveId],
  );

  if (headings.length === 0) return null;

  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-l border-border bg-surface xl:flex">
      <div className="px-5 pb-3 pt-6">
        <div className="text-micro font-semibold uppercase tracking-[0.14em] text-text3">
          On this page
        </div>
      </div>
      <nav
        className="flex-1 overflow-y-auto px-3 pb-6"
        aria-label="Page sections"
      >
        {headings.map((heading) => {
          const active = activeId === heading.id;
          return (
            <button
              key={heading.id}
              type="button"
              onClick={() => scrollToHeading(heading.id)}
              aria-current={active ? "location" : undefined}
              className={cn(
                "relative block w-full rounded-md py-1.5 text-left text-caption leading-snug transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                heading.level === 3 ? "pl-5 pr-2" : "pl-3 pr-2",
                active
                  ? "font-medium text-text1"
                  : "text-text3 hover:text-text1",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-1 left-0 top-1 w-[2px] rounded-full transition-colors",
                  active ? "bg-accent" : "bg-transparent",
                )}
              />
              {heading.title}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
