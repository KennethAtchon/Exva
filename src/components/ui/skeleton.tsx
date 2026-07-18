import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-surface3", className)}
      {...props}
    />
  );
}

/** Standard panel loading composition: title bar + three content rows. */
export function PanelLoading({
  className,
  rows = 3,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div className={cn("flex flex-col gap-4 p-4", className)} aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
