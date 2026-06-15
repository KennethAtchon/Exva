import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DocHeadingAnchor, DocSlug } from "./types";
import {
  DEFAULT_DOC_SLUG,
  getDocPage,
  getDocPager,
  listDocPages,
} from "@/components/docs/registry";

type DocsNavigationContextValue = {
  slug: DocSlug;
  page: ReturnType<typeof getDocPage>;
  navigate: (slug: DocSlug, headingId?: string) => void;
  pager: ReturnType<typeof getDocPager>;
  allPages: ReturnType<typeof listDocPages>;
};

const DocsNavigationContext = createContext<DocsNavigationContextValue | null>(
  null,
);

const HASH_PREFIX = "doc-";

function slugFromHash(): DocSlug {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.startsWith(HASH_PREFIX)) return DEFAULT_DOC_SLUG;
  const slug = raw.slice(HASH_PREFIX.length).split("/")[0];
  try {
    getDocPage(slug as DocSlug);
    return slug as DocSlug;
  } catch {
    return DEFAULT_DOC_SLUG;
  }
}

function hashForSlug(slug: DocSlug, headingId?: string): string {
  const base = `${HASH_PREFIX}${slug}`;
  return headingId ? `#${base}/${headingId}` : `#${base}`;
}

function replaceDocHash(slug: DocSlug, headingId?: string): void {
  const hash = hashForSlug(slug, headingId);
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentUrl !== nextUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function scrollToHeading(headingId: string): void {
  requestAnimationFrame(() => {
    document.getElementById(headingId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

export function DocsNavigationProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<DocSlug>(() => slugFromHash());

  const navigate = useCallback((next: DocSlug, headingId?: string) => {
    setSlug(next);
    replaceDocHash(next, headingId);
    if (headingId) {
      scrollToHeading(headingId);
    } else {
      document
        .querySelector("[data-doc-content]")
        ?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const next = slugFromHash();
      setSlug(next);
      const heading = window.location.hash.split("/")[1];
      if (heading) scrollToHeading(heading);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!window.location.hash.startsWith(`#${HASH_PREFIX}`)) {
      replaceDocHash(slug);
    }
  }, [slug]);

  const value = useMemo(
    () => ({
      slug,
      page: getDocPage(slug),
      navigate,
      pager: getDocPager(slug),
      allPages: listDocPages(),
    }),
    [navigate, slug],
  );

  return (
    <DocsNavigationContext.Provider value={value}>
      {children}
    </DocsNavigationContext.Provider>
  );
}

export function useDocsNavigation() {
  const ctx = useContext(DocsNavigationContext);
  if (!ctx) {
    throw new Error(
      "useDocsNavigation must be used within DocsNavigationProvider",
    );
  }
  return ctx;
}

export function useDocHeadings(): DocHeadingAnchor[] {
  const { page } = useDocsNavigation();
  return page.headings;
}
