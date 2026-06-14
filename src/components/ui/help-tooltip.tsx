import { Info } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "@/lib/utils";
import { getHelpEntry, type HelpGlossaryId } from "@/lib/help-glossary";

type TooltipContentProps = ComponentPropsWithoutRef<typeof TooltipContent>;

export function HelpTooltip({
  glossaryId,
  title,
  body,
  topic,
  side = "top",
  align = "center",
  className,
  triggerClassName,
}: {
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
  topic?: string;
  side?: TooltipContentProps["side"];
  align?: TooltipContentProps["align"];
  className?: string;
  triggerClassName?: string;
}) {
  const entry = getHelpEntry({ glossaryId, title, body });
  const ariaTopic = topic ?? entry.title ?? "this item";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`More information about ${ariaTopic}`}
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text3)] transition-colors hover:text-[var(--text1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              triggerClassName,
            )}
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          className={cn("max-w-xs space-y-1.5 px-3 py-2 text-left", className)}
        >
          {entry.title ? (
            <div className="text-[12px] font-semibold text-[var(--text1)]">
              {entry.title}
            </div>
          ) : null}
          <div className="text-[12px] leading-[1.45] text-[var(--text2)]">
            {entry.body}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
