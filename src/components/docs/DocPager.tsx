import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDocPage } from "./registry";
import { useDocsNavigation } from "./context";

export function DocPager() {
  const { pager, navigate } = useDocsNavigation();
  const { previous, next } = pager;
  if (!previous && !next) return null;

  return (
    <div className="mt-12 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
      {previous ? (
        <button
          type="button"
          onClick={() => navigate(previous.slug)}
          className="group rounded-lg border border-border bg-surface2 p-4 text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <div className="flex items-center gap-1 text-micro uppercase tracking-[0.1em] text-text3">
            <ChevronLeft size={14} />
            Previous
          </div>
          <div className="mt-1 text-body font-medium text-text1 group-hover:text-accent">
            {previous.title}
          </div>
        </button>
      ) : (
        <div />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => navigate(next.slug)}
          className="group rounded-lg border border-border bg-surface2 p-4 text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:col-start-2"
        >
          <div className="flex items-center justify-end gap-1 text-micro uppercase tracking-[0.1em] text-text3">
            Next
            <ChevronRight size={14} />
          </div>
          <div className="mt-1 text-right text-body font-medium text-text1 group-hover:text-accent">
            {next.title}
          </div>
        </button>
      ) : null}
    </div>
  );
}

export function RelatedPages() {
  const { page, navigate } = useDocsNavigation();
  if (!page.related?.length) return null;

  return (
    <section className="mt-10 rounded-lg border border-border bg-surface2 p-5">
      <div className="mb-3 text-micro font-semibold uppercase tracking-[0.12em] text-text3">
        Related pages
      </div>
      <div className="flex flex-wrap gap-2">
        {page.related.map((relatedSlug) => {
          const related = getDocPage(relatedSlug);
          return (
            <button
              key={relatedSlug}
              type="button"
              onClick={() => navigate(relatedSlug)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-caption font-medium text-text2 transition-colors hover:border-accent hover:text-text1 focus-visible:border-accent focus-visible:text-text1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {related.title}
            </button>
          );
        })}
      </div>
    </section>
  );
}
