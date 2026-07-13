import { Info } from "lucide-react";
import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "@/lib/utils";
import { getHelpEntry, type HelpGlossaryId } from "@/lib/help-glossary";

type TooltipContentProps = ComponentPropsWithoutRef<typeof TooltipContent>;

const HOVER_DELAY_MS = 450;
const ICON_DELAY_MS = 120;

function childIsDisabled(child: ReactNode): boolean {
  return (
    isValidElement<{ disabled?: boolean }>(child) &&
    child.props.disabled === true
  );
}

export function HelpTooltip({
  glossaryId,
  title,
  body,
  topic,
  side = "top",
  align = "center",
  className,
  triggerClassName,
  children,
}: {
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
  topic?: string;
  side?: TooltipContentProps["side"];
  align?: TooltipContentProps["align"];
  className?: string;
  triggerClassName?: string;
  children?: ReactNode;
}) {
  const entry = getHelpEntry({ glossaryId, title, body });
  const ariaTopic = topic ?? entry.title ?? "this item";
  const hasHelp = Boolean(glossaryId || body || entry.body);

  if (children && !hasHelp) {
    return children as ReactElement;
  }

  const delayDuration = children ? HOVER_DELAY_MS : ICON_DELAY_MS;
  const disabledChild = childIsDisabled(children);

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        {children ? (
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex",
                disabledChild && "cursor-not-allowed",
                triggerClassName,
              )}
              tabIndex={disabledChild ? 0 : undefined}
            >
              {children}
            </span>
          </TooltipTrigger>
        ) : (
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`More information about ${ariaTopic}`}
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text3 transition-colors hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                triggerClassName,
              )}
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
        )}
        <TooltipContent
          side={side}
          align={align}
          className={cn("max-w-xs space-y-1.5 px-3 py-2 text-left", className)}
        >
          {entry.title ? (
            <div className="text-caption font-semibold text-text1">
              {entry.title}
            </div>
          ) : null}
          <div className="text-caption leading-[1.45] text-text2">
            {entry.body}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
