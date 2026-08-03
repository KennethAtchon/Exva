import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import exvaIcon from "@/assets/exva-icon.png";

type ExvaLogoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> & {
  size?: number;
};

export function ExvaLogo({
  size = 28,
  className,
  alt = "Exva",
  ...rest
}: ExvaLogoProps) {
  return (
    <img
      src={exvaIcon}
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", className)}
      style={{ width: size, height: size }}
      draggable={false}
      {...rest}
    />
  );
}
