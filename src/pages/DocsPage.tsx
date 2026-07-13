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
        <div className="rounded-sm border border-error-border bg-error-dim px-4 py-3 font-sans text-body text-error">
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
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-surface"
      >
        <div className="mx-auto w-full max-w-[720px] flex-1 px-6 py-8 lg:px-8">
          <DocPageHeader />
          <DocsContentErrorBoundary>
            <article>
              <Page />
            </article>
          </DocsContentErrorBoundary>
          <RelatedPages />
          <DocPager />
          <footer className="mt-10 pb-4 font-sans text-caption text-text3">
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
      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
        <DocsPageContent />
      </div>
    </DocsNavigationProvider>
  );
}
