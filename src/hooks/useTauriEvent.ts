import { useEffect } from "react";
import { listenEvent, type TauriEventName, type TauriEventMap } from "@/lib/tauri";

export function useTauriEvent<K extends TauriEventName>(
  name: K,
  handler: (payload: TauriEventMap[K]) => void,
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
