import type { ReactNode } from "react";
import { HelpTooltip } from "./help-tooltip";
import type { HelpGlossaryId } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";

export function LabelWithHelp({
  label,
  children,
  glossaryId,
  title,
  body,
  required = false,
  className,
  labelClassName,
}: {
  label: string;
  children?: ReactNode;
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div
      className={cn(
        children ? "grid gap-1.5" : "flex items-center gap-1.5",
        className,
      )}
    >
      <div className={cn("flex items-center gap-1.5", labelClassName)}>
        <span>{label}</span>
        {required ? <span className="text-error">*</span> : null}
        {glossaryId || body ? (
          <HelpTooltip
            glossaryId={glossaryId}
            title={title}
            body={body}
            topic={label}
          />
        ) : null}
      </div>
      {children ? children : null}
    </div>
  );
}
