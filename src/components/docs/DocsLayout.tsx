import type { ReactNode } from "react";
import { useDocsNavigation } from "./context";

export function DocPageHeader() {
  const { page } = useDocsNavigation();

  return (
    <header className="mb-6 border-b border-[var(--border)] pb-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        {page.category}
      </div>
      <h1 className="m-0 mt-2 text-[28px] font-semibold text-[var(--text1)]">
        {page.title}
      </h1>
      <p className="m-0 mt-2 max-w-2xl text-[14px] leading-[1.6] text-[var(--text3)]">
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
