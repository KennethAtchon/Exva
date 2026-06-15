import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useDocsNavigation } from "./context";
import { getDocGroupTrail } from "./registry";

export function DocPageHeader() {
  const { page, slug } = useDocsNavigation();
  const trail = getDocGroupTrail(slug);
  const crumbs = [
    ...(trail.length ? trail.map((g) => g.label) : [page.category]),
    page.title,
  ];

  return (
    <header className="mb-8 border-b border-[var(--border)] pb-6">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]"
      >
        {crumbs.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <ChevronRight
                size={12}
                aria-hidden
                className="text-[var(--text3)]"
              />
            ) : null}
            <span
              className={
                i === crumbs.length - 1 ? "text-[var(--text2)]" : undefined
              }
            >
              {crumb}
            </span>
          </Fragment>
        ))}
      </nav>
      <h1 className="m-0 mt-3 text-[28px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text1)]">
        {page.title}
      </h1>
      <p className="m-0 mt-2.5 max-w-2xl text-[15px] leading-[1.6] text-[var(--text3)]">
        {page.description}
      </p>
    </header>
  );
}

export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {children}
    </div>
  );
}
