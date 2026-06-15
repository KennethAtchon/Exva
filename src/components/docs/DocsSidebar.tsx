import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DOC_NAV_GROUPS,
  getDocGroupTrail,
  listDocPages,
  searchDocPages,
} from "./registry";
import { useActiveHeading, useDocsNavigation } from "./context";
import type { DocNavGroup, DocSlug } from "./types";

const STORAGE_KEY = "exva-docs-nav-open";

type OpenState = Record<string, boolean>;

function readOpenState(): OpenState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as OpenState;
  } catch {
    // Ignore unavailable / corrupt storage and fall back to defaults.
  }
  return {};
}

function writeOpenState(state: OpenState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable; persistence is best-effort.
  }
}

export function DocsSidebar() {
  const { slug, page, navigate } = useDocsNavigation();
  const [query, setQuery] = useState("");
  const pages = useMemo(() => listDocPages(), []);
  const results = useMemo(() => searchDocPages(query), [query]);
  const showSearch = query.trim().length > 0;

  // Every group from the top down to the one holding the active page.
  const trailIds = useMemo(
    () => getDocGroupTrail(slug).map((group) => group.id),
    [slug],
  );

  // Groups default to open; persisted user collapses (and `?? true` reads)
  // handle any group id, including nested subgroups.
  const [open, setOpen] = useState<OpenState>(() => readOpenState());

  // Every ancestor group of the active page is always expanded.
  useEffect(() => {
    if (trailIds.length === 0) return;
    setOpen((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of trailIds) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [trailIds]);

  const toggleGroup = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      writeOpenState(next);
      return next;
    });
  };

  // Active heading for the nested drill-down beneath the current page.
  const [activeHeadingId] = useActiveHeading(page.headings);

  const renderPageLink = (pageSlug: DocSlug): ReactNode => {
    const groupPage = pages.find((p) => p.slug === pageSlug);
    if (!groupPage) return null;
    const active = slug === pageSlug;
    const showHeadings = active && page.headings.length > 0;
    return (
      <div key={pageSlug}>
        <button
          type="button"
          onClick={() => navigate(pageSlug)}
          aria-current={active ? "page" : undefined}
          className={cn(
            "block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
            active
              ? "bg-[var(--surface2)] font-medium text-[var(--text1)]"
              : "text-[var(--text2)] hover:bg-[var(--surface2)] hover:text-[var(--text1)]",
          )}
        >
          {groupPage.title}
        </button>
        {showHeadings ? (
          <div className="mb-1 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
            {page.headings.map((heading) => {
              const headingActive = activeHeadingId === heading.id;
              return (
                <button
                  key={heading.id}
                  type="button"
                  onClick={() => navigate(pageSlug, heading.id)}
                  aria-current={headingActive ? "location" : undefined}
                  className={cn(
                    "block w-full rounded-md py-1 text-left text-[12px] leading-snug transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
                    heading.level === 3 ? "pl-5 pr-2" : "pl-2.5 pr-2",
                    headingActive
                      ? "font-medium text-[var(--accent)]"
                      : "text-[var(--text3)] hover:text-[var(--text1)]",
                  )}
                >
                  {heading.title}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderGroup = (group: DocNavGroup, depth: number): ReactNode => {
    const expanded = open[group.id] ?? true;
    const groupActive = trailIds.includes(group.id);
    return (
      <div key={group.id} className={depth === 0 ? "mb-1" : "mt-0.5"}>
        <button
          type="button"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={expanded}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
            "text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-[var(--text1)]",
            groupActive ? "text-[var(--text2)]" : "text-[var(--text3)]",
          )}
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-[var(--text3)] transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
          {group.label}
        </button>
        {expanded ? (
          <div className="mb-3 ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
            {group.slugs.map((pageSlug) => renderPageLink(pageSlug))}
            {group.subgroups?.map((sub) => renderGroup(sub, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="px-4 pb-4 pt-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
          Documentation
        </div>
        <label className="relative mt-3 block">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text3)]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface2)] pl-8 pr-2 text-[12px] text-[var(--text1)] outline-none placeholder:text-[var(--text3)] focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-2 pb-4"
        aria-label="Documentation pages"
      >
        {showSearch ? (
          <div className="space-y-1">
            {results.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--text3)]">
                No pages match your search.
              </div>
            ) : (
              results.map((result) => (
                <button
                  key={result.slug}
                  type="button"
                  onClick={() => {
                    navigate(result.slug);
                    setQuery("");
                  }}
                  className={cn(
                    "block w-full rounded-md px-3 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
                    slug === result.slug
                      ? "bg-[var(--surface2)] text-[var(--text1)]"
                      : "text-[var(--text2)] hover:bg-[var(--surface2)]",
                  )}
                >
                  <div className="text-[13px] font-medium">{result.title}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text3)]">
                    {result.category}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          DOC_NAV_GROUPS.map((group) => renderGroup(group, 0))
        )}
      </nav>
    </aside>
  );
}
