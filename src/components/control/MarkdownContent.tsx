import { Fragment } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const INLINE_TOKEN_RE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`link-${index}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-4"
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={`code-${index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5]) {
      nodes.push(<strong key={`strong-${index}`}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={`em-${index}`}>{match[6]}</em>);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderInlineWithBreaks(text: string): ReactNode[] {
  return text.split("\n").flatMap((line, index, arr) => {
    const segment = renderInline(line);
    if (index === arr.length - 1) return segment;
    return [...segment, <br key={`br-${index}`} />];
  });
}

function isUnorderedListLine(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isQuoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

function isFenceLine(line: string): boolean {
  return /^```/.test(line);
}

function isBlockStart(line: string): boolean {
  return (
    isHeadingLine(line) ||
    isQuoteLine(line) ||
    isFenceLine(line) ||
    isUnorderedListLine(line) ||
    isOrderedListLine(line)
  );
}

export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isFenceLine(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !isFenceLine(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += i < lines.length ? 1 : 0;
      blocks.push(
        <pre
          key={`code-block-${blocks.length}`}
          className="overflow-x-auto rounded-2xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (isHeadingLine(line)) {
      const [, hashes, title] = line.match(/^(#{1,6})\s+(.*)$/) ?? [];
      const level = hashes?.length ?? 2;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const headingClass =
        level <= 2
          ? "text-base font-semibold text-foreground"
          : "text-sm font-semibold text-foreground";
      blocks.push(
        <Tag key={`heading-${blocks.length}`} className={headingClass}>
          {renderInline(title ?? line)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && isQuoteLine(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInlineWithBreaks(quoteLines.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    if (isUnorderedListLine(line) || isOrderedListLine(line)) {
      const ordered = isOrderedListLine(line);
      const ListTag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? isOrderedListLine(lines[i]) : isUnorderedListLine(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ListTag
          key={`list-${blocks.length}`}
          className={cn(
            "space-y-1 pl-5 text-foreground",
            ordered ? "list-decimal" : "list-disc",
          )}
        >
          {items.map((item, index) => (
            <li key={`item-${index}`}>{renderInline(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p
        key={`paragraph-${blocks.length}`}
        className="whitespace-pre-wrap break-words leading-relaxed text-foreground"
      >
        {renderInlineWithBreaks(paragraph.join("\n"))}
      </p>,
    );
  }

  return (
    <div className={cn("space-y-3 text-sm", className)}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{block}</Fragment>
      ))}
    </div>
  );
}
