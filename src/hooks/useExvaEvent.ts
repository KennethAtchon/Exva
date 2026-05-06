import { useEffect } from "react";
import { listenEvent, type ExvaEventMap, type ExvaEventName } from "@/lib/exva";

export function useExvaEvent<K extends ExvaEventName>(
  name: K,
  handler: (payload: ExvaEventMap[K]) => void,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenEvent(name, handler).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, deps);
}
