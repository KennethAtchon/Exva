import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocMermaid } from "@/components/docs/DocMermaid";

const proseClass = cn(
  "space-y-3 text-sm text-text1",
  "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-text1",
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text1",
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text1",
  "[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-text1",
  "[&_p]:whitespace-pre-wrap [&_p]:break-words [&_p]:leading-relaxed",
  "[&_a]:text-info [&_a]:underline [&_a]:underline-offset-4",
  "[&_strong]:font-semibold [&_strong]:text-text1",
  "[&_em]:italic",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
  "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
  "[&_li]:text-text1",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text2",
  "[&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-caption",
  "[&_th]:border [&_th]:border-border [&_th]:bg-surface2 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_th]:text-text2",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-text1",
  "[&_input[type=checkbox]]:mr-2",
);

type FenceInfo = {
  lang: string;
  body: string;
};

/** Peel an unclosed trailing fence so streaming doesn't open a runaway `<pre>`. */
function splitTrailingIncompleteFence(content: string): {
  markdown: string;
  incomplete: FenceInfo | null;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceLang = "";
  let fenceStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("```")) continue;
    if (!inFence) {
      inFence = true;
      fenceLang = lines[i].slice(3).trim().toLowerCase();
      fenceStart = i;
    } else {
      inFence = false;
      fenceLang = "";
      fenceStart = -1;
    }
  }

  if (!inFence || fenceStart < 0) {
    return { markdown: normalized, incomplete: null };
  }

  return {
    markdown: lines.slice(0, fenceStart).join("\n"),
    incomplete: {
      lang: fenceLang,
      body: lines.slice(fenceStart + 1).join("\n"),
    },
  };
}

function InlineCode({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        "rounded bg-surface2 px-1 py-0.5 font-mono text-[0.9em] text-text1",
        className,
      )}
    >
      {children}
    </code>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const label = language || "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in some environments.
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface2">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-micro uppercase tracking-wider text-text3">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-micro text-text3 transition-colors hover:bg-surface3 hover:text-text1"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs text-text1">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function IncompleteFence({ lang, body }: FenceInfo) {
  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-border bg-surface2/80">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-micro uppercase tracking-wider text-text3">
          {lang || "text"}
        </span>
        <span className="font-mono text-micro text-text3">Streaming…</span>
      </div>
      <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-xs text-text2">
        <code>{body}</code>
      </pre>
    </div>
  );
}

function MarkdownCode({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase() ?? "";
  const raw = String(children).replace(/\n$/, "");
  const isBlock =
    Boolean(match) || (typeof children === "string" && children.includes("\n"));

  if (!isBlock) {
    return (
      <InlineCode className={className} {...props}>
        {children}
      </InlineCode>
    );
  }

  if (language === "mermaid") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return <IncompleteFence lang="mermaid" body="" />;
    }
    return (
      <div className="[&_.mb-6]:mb-0">
        <DocMermaid chart={trimmed} />
      </div>
    );
  }

  return <CodeBlock language={language} code={raw} />;
}

export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const { markdown, incomplete } = splitTrailingIncompleteFence(content);

  return (
    <div className={cn(proseClass, className)}>
      {markdown.trim() ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: MarkdownCode,
            pre: ({ children }) => <>{children}</>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      ) : null}
      {incomplete ? (
        <IncompleteFence lang={incomplete.lang} body={incomplete.body} />
      ) : null}
    </div>
  );
}
