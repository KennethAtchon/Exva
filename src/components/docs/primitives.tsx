import { useState, type ReactNode } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocsNavigation } from "./context";
import type { DocSlug } from "./types";

export { DocMermaid } from "./DocMermaid";

export const DocHeading = ({
  id,
  level = 2,
  children,
}: {
  id: string;
  level?: 2 | 3;
  children: ReactNode;
}) => {
  const { slug, navigate } = useDocsNavigation();
  const Tag = level === 2 ? "h2" : "h3";
  const linkToHeading = () => {
    navigate(slug, id);
    try {
      const url = `${window.location.origin}${window.location.pathname}#doc-${slug}/${id}`;
      void navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard may be unavailable; navigation still updates the hash.
    }
  };
  return (
    <Tag
      id={id}
      className={cn(
        "group/heading scroll-mt-6 text-text1",
        level === 2
          ? "mb-4 mt-10 border-b border-border pb-3 font-sans text-head first:mt-0"
          : "mb-3 mt-7 font-sans text-label",
      )}
    >
      <span className="inline-flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={linkToHeading}
          aria-label={`Link to section: ${id}`}
          className="inline-flex items-center text-text3 opacity-0 transition-opacity duration-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none group-hover/heading:opacity-100"
        >
          <Link2 size={level === 2 ? 15 : 13} />
        </button>
      </span>
    </Tag>
  );
};

export const DocParagraph = ({ children }: { children: ReactNode }) => (
  <p className="m-0 mb-4 font-sans text-body leading-relaxed text-text2">
    {children}
  </p>
);

export const DocInlineCode = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm border border-border bg-surface2 px-1.5 py-0.5 font-mono text-caption text-text1">
    {children}
  </code>
);

export const DocStrong = ({ children }: { children: ReactNode }) => (
  <strong className="font-medium text-text1">{children}</strong>
);

export const DocLink = ({
  to,
  heading,
  children,
  className,
}: {
  to: DocSlug;
  heading?: string;
  children: ReactNode;
  className?: string;
}) => {
  const { navigate } = useDocsNavigation();
  return (
    <button
      type="button"
      onClick={() => navigate(to, heading)}
      className={cn(
        "inline cursor-pointer border-none bg-transparent p-0 font-sans text-body font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </button>
  );
};

export const DocList = ({ items }: { items: ReactNode[] }) => (
  <ul className="mb-4 list-disc space-y-2 pl-5 font-sans text-body leading-relaxed text-text2">
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

export const DocCallout = ({
  variant = "info",
  title,
  children,
}: {
  variant?: "info" | "warning" | "tip";
  title?: string;
  children: ReactNode;
}) => {
  const styles = {
    info: "border-info-border bg-info-dim",
    warning: "border-warning-border bg-warning-dim",
    tip: "border-success-border bg-success-dim",
  };
  return (
    <div className={cn("mb-5 rounded-sm border px-4 py-3", styles[variant])}>
      {title ? (
        <div className="mb-1 font-sans text-label text-text1">{title}</div>
      ) : null}
      <div className="font-sans text-body leading-relaxed text-text2">
        {children}
      </div>
    </div>
  );
};

export const DocCode = ({ children }: { children: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };
  return (
    <div className="group/code relative mb-5">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-text3 transition-all duration-hover hover:border-primary hover:text-text1 focus-visible:opacity-100 focus-visible:outline-none",
          copied
            ? "opacity-100 text-success"
            : "opacity-0 group-hover/code:opacity-100",
        )}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="overflow-x-auto rounded-sm border border-border bg-surface2 px-4 py-3 pr-12 font-mono text-caption leading-relaxed text-text1">
        {children}
      </pre>
    </div>
  );
};

export const DocTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) => (
  <div className="mb-6 overflow-x-auto rounded-sm border border-border">
    <table className="w-full min-w-[480px] border-collapse text-left">
      <thead>
        <tr className="border-b border-border bg-surface2">
          {headers.map((header) => (
            <th
              key={header}
              className="px-4 py-2.5 font-mono text-micro uppercase tracking-wider text-text3"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr
            key={rowIndex}
            className="border-b border-border last:border-0 hover:bg-surface2"
          >
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className="px-4 py-2.5 align-top font-sans text-body text-text2"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const FlowStep = ({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: ReactNode;
}) => (
  <div className="relative mb-4 flex gap-4 rounded-sm border border-border bg-surface2 p-4">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-caption font-bold text-primary-foreground">
      {step}
    </div>
    <div className="min-w-0 flex-1">
      <div className="mb-1 font-sans text-label text-text1">{title}</div>
      <div className="font-sans text-body leading-relaxed text-text2">
        {children}
      </div>
    </div>
  </div>
);

export const GlossaryTerm = ({
  id,
  term,
  definition,
  related,
}: {
  id: string;
  term: string;
  definition: ReactNode;
  related?: ReactNode;
}) => (
  <div
    id={id}
    className="scroll-mt-6 border-b border-border py-3 last:border-0"
  >
    <dt className="font-sans text-label text-text1">{term}</dt>
    <dd className="mt-1 font-sans text-body leading-relaxed text-text2">
      {definition}
      {related ? (
        <div className="mt-2 font-sans text-caption text-text3">
          See also: {related}
        </div>
      ) : null}
    </dd>
  </div>
);

export const DocCardGrid = ({ children }: { children: ReactNode }) => (
  <div className="mb-6 grid gap-3 sm:grid-cols-2">{children}</div>
);

export const DocCard = ({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: DocSlug;
}) => {
  const { navigate } = useDocsNavigation();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="rounded-sm border border-border bg-surface2 p-4 text-left transition-colors duration-hover hover:border-primary hover:bg-surface focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <div className="font-sans text-label text-text1">{title}</div>
      <div className="mt-1.5 font-sans text-body leading-relaxed text-text3">
        {description}
      </div>
    </button>
  );
};
