import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { api } from "@/lib/exva";
import type { PageKey } from "@/lib/nav";

export type PaletteNavigate = (target: {
  page?: PageKey;
  settingsTab?: string;
  researchTab?: string;
  signalsTab?: string;
  tradeId?: string;
  sessionId?: string;
  docsSlug?: string;
}) => void;

export type PaletteAction = {
  id: string;
  title: string;
  keywords: string;
  scope: "global" | "session" | "dev";
  destructive?: boolean;
  run: () => void | Promise<void>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: PaletteNavigate;
  actions: PaletteAction[];
};

/**
 * Global ⌘K command palette — fuzzy actions + entity search (finish-line 08 T1).
 * Destructive actions require a second Enter to confirm.
 */
export function CommandPalette({
  open,
  onOpenChange,
  navigate,
  actions,
}: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<
    Array<{
      id: string;
      kind: string;
      title: string;
      subtitle?: string;
      payload: Record<string, string>;
    }>
  >([]);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setPendingConfirm(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!q.trim()) {
        setHits([]);
        return;
      }
      void api
        .paletteQuery(q.trim())
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const filteredActions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.keywords.toLowerCase().includes(needle) ||
        a.id.includes(needle),
    );
  }, [actions, q]);

  const runAction = useCallback(
    async (action: PaletteAction) => {
      if (action.destructive && pendingConfirm !== action.id) {
        setPendingConfirm(action.id);
        return;
      }
      setPendingConfirm(null);
      onOpenChange(false);
      await action.run();
    },
    [onOpenChange, pendingConfirm],
  );

  const runHit = useCallback(
    (hit: (typeof hits)[number]) => {
      onOpenChange(false);
      switch (hit.kind) {
        case "session":
          if (hit.payload.sessionId) {
            void api.focusSession(hit.payload.sessionId);
            navigate({ page: "sessions", sessionId: hit.payload.sessionId });
          }
          break;
        case "trade":
          if (hit.payload.tradeId) {
            navigate({ page: "dashboard", tradeId: hit.payload.tradeId });
          }
          break;
        case "docs":
          navigate({ page: "docs", docsSlug: hit.payload.slug });
          break;
        case "settings":
          navigate({
            page: "settings",
            settingsTab: hit.payload.settingsTab,
          });
          break;
        case "instrument":
          navigate({ page: "signals", signalsTab: "instruments" });
          break;
        default:
          break;
      }
    },
    [navigate, onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search actions, sessions, trades…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {filteredActions.length > 0 ? (
          <CommandGroup heading="Actions">
            {filteredActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`${action.title} ${action.keywords}`}
                onSelect={() => void runAction(action)}
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span>{action.title}</span>
                  {action.destructive && pendingConfirm === action.id ? (
                    <span className="font-mono text-[11px] text-error">
                      Enter to confirm
                    </span>
                  ) : action.destructive ? (
                    <span className="font-mono text-[11px] text-[var(--text3)]">
                      destructive
                    </span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {hits.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Search">
              {hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`${hit.title} ${hit.subtitle ?? ""} ${hit.kind}`}
                  onSelect={() => runHit(hit)}
                >
                  <div className="flex flex-col">
                    <span>{hit.title}</span>
                    <span className="font-mono text-[11px] text-[var(--text3)]">
                      {hit.kind}
                      {hit.subtitle ? ` · ${hit.subtitle}` : ""}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
