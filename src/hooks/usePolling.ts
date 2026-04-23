import { useEffect, useRef } from "react";

export function usePolling(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const cbRef = useRef(fn);
  cbRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const tick = async () => {
      if (!active) return;
      await cbRef.current();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intervalMs, enabled]);
}
