import { Component, type ReactNode } from "react";
import {
  DocsNavigationProvider,
  useDocsNavigation,
} from "@/components/docs/context";
import { DocPager, RelatedPages } from "@/components/docs/DocPager";
import { DocPageHeader, DocsLayout } from "@/components/docs/DocsLayout";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { DocsToc } from "@/components/docs/DocsToc";

class DocsContentErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-error-border bg-error-dim px-4 py-3 text-[13px] text-error">
          This documentation page failed to render. Try another page from the
          sidebar, or reload the app.
        </div>
      );
    }
    return this.props.children;
  }
}

function DocsPageContent() {
  const { page } = useDocsNavigation();
  const Page = page.component;

  return (
    <DocsLayout>
      <DocsSidebar />
      <main
        data-doc-content
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--surface)]"
      >
        <div className="mx-auto w-full max-w-3xl flex-1 px-7 py-8 lg:px-9">
          <DocPageHeader />
          <DocsContentErrorBoundary>
            <article>
              <Page />
            </article>
          </DocsContentErrorBoundary>
          <RelatedPages />
          <DocPager />
          <footer className="mt-10 pb-4 text-[12px] text-[var(--text3)]">
            Exva operator documentation — reflects the signal-driven
            architecture in the current codebase.
          </footer>
        </div>
      </main>
      <DocsToc />
    </DocsLayout>
  );
}

export function DocsPage() {
  return (
    <DocsNavigationProvider>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--surface)]">
        <DocsPageContent />
      </div>
    </DocsNavigationProvider>
  );
}
