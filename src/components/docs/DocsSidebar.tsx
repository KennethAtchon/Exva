import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOC_NAV_GROUPS, listDocPages, searchDocPages } from "./registry";
import { useDocsNavigation } from "./context";

export function DocsSidebar() {
  const { slug, navigate } = useDocsNavigation();
  const [query, setQuery] = useState("");
  const pages = useMemo(() => listDocPages(), []);
  const results = useMemo(() => searchDocPages(query), [query]);
  const showSearch = query.trim().length > 0;

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
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
        className="flex-1 overflow-y-auto px-2 py-3"
        aria-label="Documentation pages"
      >
        {showSearch ? (
          <div className="space-y-1">
            {results.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--text3)]">
                No pages match your search.
              </div>
            ) : (
              results.map((page) => (
                <button
                  key={page.slug}
                  type="button"
                  onClick={() => {
                    navigate(page.slug);
                    setQuery("");
                  }}
                  className={cn(
                    "block w-full rounded-md px-3 py-2 text-left transition-colors",
                    slug === page.slug
                      ? "bg-[var(--surface2)] text-[var(--text1)]"
                      : "text-[var(--text2)] hover:bg-[var(--surface2)]",
                  )}
                >
                  <div className="text-[13px] font-medium">{page.title}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text3)]">
                    {page.category}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          DOC_NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text3)]">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.slugs.map((pageSlug) => {
                  const page = pages.find((p) => p.slug === pageSlug);
                  if (!page) return null;
                  const active = slug === pageSlug;
                  return (
                    <button
                      key={pageSlug}
                      type="button"
                      onClick={() => navigate(pageSlug)}
                      className={cn(
                        "block w-full rounded-md px-3 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-[var(--surface2)] font-medium text-[var(--text1)]"
                          : "text-[var(--text2)] hover:bg-[var(--surface2)] hover:text-[var(--text1)]",
                      )}
                    >
                      {page.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
