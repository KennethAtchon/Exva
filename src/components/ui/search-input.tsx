import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

const sizeStyles = {
  sm: { wrapper: "h-7", pl: "pl-7", pr: "pr-7", icon: 13, iconLeft: "left-2", text: "text-caption" },
  md: { wrapper: "h-8", pl: "pl-8", pr: "pr-8", icon: 14, iconLeft: "left-2.5", text: "text-body" },
  lg: { wrapper: "h-10", pl: "pl-9", pr: "pr-9", icon: 16, iconLeft: "left-3", text: "text-body" },
} as const;

export type SearchInputSize = keyof typeof sizeStyles;

export interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "size"> {
  /** Visual size. Defaults to `md` (h-8) to match the app's Input primitive. */
  size?: SearchInputSize;
  /** Current value. Controlled — pair with `onChange` (or `onValueChange`). */
  value?: string;
  /** Convenience callback returning the new string value directly. */
  onValueChange?: (value: string) => void;
  /** Shown as a spinner/badge slot on the right, before the clear button. */
  endSlot?: React.ReactNode;
  /** Class for the outer wrapper (layout, flex, width). */
  containerClassName?: string;
}

/**
 * Unified search field: leading search icon, consistent focus ring, and a
 * clear (×) button that appears once there is a value. Use this everywhere a
 * "search / filter" text box is needed so the experience stays consistent.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      size = "md",
      value,
      onChange,
      onValueChange,
      endSlot,
      className,
      containerClassName,
      placeholder = "Search…",
      disabled,
      ...props
    },
    ref,
  ) => {
    const s = sizeStyles[size];
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    const hasValue = value != null && value !== "";

    const emit = (next: string) => {
      onValueChange?.(next);
    };

    const handleClear = () => {
      const el = innerRef.current;
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
      }
      emit("");
    };

    return (
      <div
        className={cn(
          "relative flex items-center rounded-sm border border-hairline bg-surface2",
          "focus-within:border-accent focus-within:ring-1 focus-within:ring-accent",
          "transition-colors duration-hover",
          disabled && "cursor-not-allowed opacity-50",
          s.wrapper,
          containerClassName,
        )}
      >
        <Search
          size={s.icon}
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-text3",
            s.iconLeft,
          )}
        />
        <input
          ref={innerRef}
          type="search"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            onChange?.(event);
            emit(event.target.value);
          }}
          className={cn(
            "h-full w-full min-w-0 rounded-sm bg-transparent font-sans text-text1 outline-none",
            "placeholder:text-text3 disabled:cursor-not-allowed",
            // hide native clear affordance; we render our own
            "[&::-webkit-search-cancel-button]:appearance-none",
            s.pl,
            hasValue || endSlot ? s.pr : "pr-2.5",
            s.text,
            className,
          )}
          {...props}
        />
        {endSlot ? (
          <span className="absolute right-2 flex items-center text-text3">
            {endSlot}
          </span>
        ) : hasValue && !disabled ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className={cn(
              "absolute right-1.5 flex items-center justify-center rounded-sm p-0.5",
              "text-text3 transition-colors duration-hover hover:text-text1",
            )}
          >
            <X size={s.icon} />
          </button>
        ) : null}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
