import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDocHeadings, useDocsNavigation } from "./context";

export function DocsToc() {
  const headings = useDocHeadings();
  const { navigate, slug } = useDocsNavigation();
  const [activeId, setActiveId] = useState<string | null>(null);

  const scrollToHeading = useCallback(
    (id: string) => {
      navigate(slug, id);
      setActiveId(id);
    },
    [navigate, slug],
  );

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId(null);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [headings, slug]);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] xl:flex">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
          On this page
        </div>
      </div>
      <nav
        className="flex-1 overflow-y-auto px-2 py-3"
        aria-label="Page sections"
      >
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            onClick={() => scrollToHeading(heading.id)}
            className={cn(
              "mb-0.5 block w-full rounded-md py-1.5 text-left text-[12px] transition-colors",
              heading.level === 3 ? "pl-6 pr-3" : "px-3",
              activeId === heading.id
                ? "font-medium text-[var(--accent)]"
                : "text-[var(--text3)] hover:text-[var(--text2)]",
            )}
          >
            {heading.title}
          </button>
        ))}
      </nav>
    </aside>
  );
}
