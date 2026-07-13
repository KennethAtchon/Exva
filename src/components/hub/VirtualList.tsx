import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type Props<T> = {
  items: T[];
  rowHeight: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
};

/**
 * Windowed list for unbounded hub rows (trades, events). No extra deps —
 * measures scroll parent and only mounts visible + overscan rows.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 8,
  className,
  style,
  getKey,
  renderRow,
  empty,
}: Props<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h != null && h > 0) setViewportHeight(h);
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    setViewportHeight(el.clientHeight || 400);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  if (items.length === 0) {
    return <>{empty ?? null}</>;
  }

  const totalHeight = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div
      ref={scrollerRef}
      className={cn("relative overflow-auto", className)}
      style={style}
    >
      <div className="relative" style={{ height: totalHeight }}>
        <div
          className="absolute right-0 left-0"
          style={{ top: start * rowHeight }}
        >
          {slice.map((item, i) => {
            const index = start + i;
            return (
              <div
                key={getKey(item, index)}
                className="box-border"
                style={{ height: rowHeight }}
              >
                {renderRow(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
