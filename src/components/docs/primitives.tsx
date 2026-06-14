import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDocsNavigation } from "./context";
import type { DocSlug } from "./types";

export const DocHeading = ({
  id,
  level = 2,
  children,
}: {
  id: string;
  level?: 2 | 3;
  children: ReactNode;
}) => {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={id}
      className={cn(
        "scroll-mt-6 text-[var(--text1)]",
        level === 2
          ? "mb-4 mt-10 border-b border-[var(--border)] pb-3 text-[20px] font-semibold first:mt-0"
          : "mb-3 mt-7 text-[15px] font-semibold",
      )}
    >
      {children}
    </Tag>
  );
};

export const DocParagraph = ({ children }: { children: ReactNode }) => (
  <p className="m-0 mb-4 text-[14px] leading-[1.65] text-[var(--text2)]">
    {children}
  </p>
);

export const DocInlineCode = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-[var(--surface2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text1)]">
    {children}
  </code>
);

export const DocStrong = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-[var(--text1)]">{children}</strong>
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
        "inline cursor-pointer border-none bg-transparent p-0 text-[14px] font-medium text-[var(--accent)] underline-offset-2 hover:underline",
        className,
      )}
    >
      {children}
    </button>
  );
};

export const DocList = ({ items }: { items: ReactNode[] }) => (
  <ul className="mb-4 list-disc space-y-2 pl-5 text-[14px] leading-[1.6] text-[var(--text2)]">
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
    <div className={cn("mb-5 rounded-lg border px-4 py-3", styles[variant])}>
      {title ? (
        <div className="mb-1 text-[13px] font-semibold text-[var(--text1)]">
          {title}
        </div>
      ) : null}
      <div className="text-[13px] leading-[1.6] text-[var(--text2)]">
        {children}
      </div>
    </div>
  );
};

export const DocCode = ({ children }: { children: string }) => (
  <pre className="mb-5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 font-mono text-[12px] leading-[1.55] text-[var(--text1)]">
    {children}
  </pre>
);

export const DocTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) => (
  <div className="mb-6 overflow-x-auto rounded-lg border border-[var(--border)]">
    <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
      <thead>
        <tr className="border-b border-[var(--border)] bg-[var(--surface2)]">
          {headers.map((header) => (
            <th
              key={header}
              className="px-4 py-2.5 font-semibold text-[var(--text1)]"
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
            className="border-b border-[var(--border)] last:border-0"
          >
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className="px-4 py-2.5 align-top text-[var(--text2)]"
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
  <div className="relative mb-4 flex gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-4">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-mono text-[12px] font-bold text-[hsl(var(--primary-foreground))]">
      {step}
    </div>
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[14px] font-semibold text-[var(--text1)]">
        {title}
      </div>
      <div className="text-[13px] leading-[1.6] text-[var(--text2)]">
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
    className="scroll-mt-6 border-b border-[var(--border)] py-3 last:border-0"
  >
    <dt className="text-[14px] font-semibold text-[var(--text1)]">{term}</dt>
    <dd className="mt-1 text-[13px] leading-[1.55] text-[var(--text2)]">
      {definition}
      {related ? (
        <div className="mt-2 text-[12px] text-[var(--text3)]">
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
      className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-4 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface)]"
    >
      <div className="text-[14px] font-semibold text-[var(--text1)]">
        {title}
      </div>
      <div className="mt-1.5 text-[13px] leading-[1.5] text-[var(--text3)]">
        {description}
      </div>
    </button>
  );
};
