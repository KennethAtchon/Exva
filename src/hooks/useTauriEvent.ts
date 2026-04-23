import { useEffect } from "react";
import { listenEvent, type ExvaEventName, type ExvaEventMap } from "@/lib/exva";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const useTauriEvent = useExvaEvent;
