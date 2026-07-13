import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-sans text-label transition-colors duration-hover disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        secondary:
          "border border-border bg-surface2 text-text1 hover:bg-surface3",
        outline:
          "border border-border bg-transparent text-text1 hover:bg-surface2",
        ghost: "bg-transparent text-text2 hover:bg-surface2 hover:text-text1",
        destructive:
          "border border-error-border bg-error-dim text-error hover:opacity-90",
        warning:
          "border border-warning-border bg-warning-dim text-warning hover:opacity-90",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-caption",
        md: "h-8 px-3",
        lg: "h-9 px-4",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
