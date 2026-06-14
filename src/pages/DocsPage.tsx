import {
  DocsNavigationProvider,
  useDocsNavigation,
} from "@/components/docs/context";
import { DocPager, RelatedPages } from "@/components/docs/DocPager";
import { DocPageHeader, DocsLayout } from "@/components/docs/DocsLayout";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { DocsToc } from "@/components/docs/DocsToc";

function DocsPageContent() {
  const { page } = useDocsNavigation();
  const Page = page.component;

  return (
    <DocsLayout>
      <DocsSidebar />
      <main
        data-doc-content
        className="flex min-w-0 flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl flex-1 px-7 py-8 lg:px-9">
          <DocPageHeader />
          <article>
            <Page />
          </article>
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
      <DocsPageContent />
    </DocsNavigationProvider>
  );
}
