import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/exva";
import {
  diffConfigDocs,
  formatConfigSavedAt,
  isStaleVersionError,
  staleVersionUserMessage,
  type StrategyConfigRecord,
} from "@/lib/strategy-config-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

type HistoryEntry = {
  id: string;
  sessionId: string;
  version: number;
  doc: unknown;
  savedAt: string;
};

export function ConfigHistoryDrawer({
  open,
  sessionId,
  currentVersion,
  isLocked,
  onClose,
  onRolledBack,
  onVersionRefresh,
}: {
  open: boolean;
  sessionId: string;
  currentVersion: number | null;
  isLocked: boolean;
  onClose: () => void;
  onRolledBack: (record: StrategyConfigRecord) => void;
  /** Called when a stale rollback refreshes the live config so parent store matches. */
  onVersionRefresh?: (record: StrategyConfigRecord) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [current, setCurrent] = useState<StrategyConfigRecord | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [historyResult, config] = await Promise.all([
          api.getStrategyConfigHistory(sessionId),
          api.getStrategyConfig(sessionId),
        ]);
        if (cancelled) return;
        setHistory(historyResult.history);
        setCurrent(config);
        setSelectedVersion(historyResult.history[0]?.version ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load config history.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const selected = useMemo(
    () => history.find((entry) => entry.version === selectedVersion) ?? null,
    [history, selectedVersion],
  );

  const diffs = useMemo(() => {
    if (!selected || !current) return [];
    return diffConfigDocs(selected.doc, current.doc);
  }, [selected, current]);

  if (!open) return null;

  const handleRollback = async () => {
    if (!selected) return;
    const expectedVersion = current?.version ?? currentVersion;
    if (expectedVersion == null) return;
    if (
      !window.confirm(
        `Roll back to version ${selected.version}? The current config becomes a new history entry.`,
      )
    ) {
      return;
    }
    setRollingBack(true);
    setError(null);
    try {
      const result = await api.rollbackStrategyConfig({
        sessionId,
        version: selected.version,
        expectedVersion,
      });
      onRolledBack(result);
      onClose();
    } catch (err) {
      if (isStaleVersionError(err)) {
        setError(staleVersionUserMessage());
        try {
          const [historyResult, config] = await Promise.all([
            api.getStrategyConfigHistory(sessionId),
            api.getStrategyConfig(sessionId),
          ]);
          setHistory(historyResult.history);
          setCurrent(config);
          onVersionRefresh?.(config);
        } catch {
          // Keep the stale message; user can close and reopen.
        }
      } else {
        setError(err instanceof Error ? err.message : "Rollback failed.");
      }
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className={overlayClass} role="dialog" aria-modal="true">
      <button
        type="button"
        className={backdropClass}
        aria-label="Close config history"
        onClick={onClose}
      />
      <aside className={panelClass}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-head font-bold text-text1">Config history</div>
            <p className="mt-1 text-caption leading-[1.5] text-text3">
              Prior versions of this session&apos;s strategy document. Select a
              row to compare sections, then roll back if needed.
            </p>
          </div>
          <button type="button" onClick={onClose} className={closeButtonClass}>
            Close
          </button>
        </div>

        {error ? <div className={errorBannerClass}>{error}</div> : null}

        {loading ? (
          <div className="px-5 py-6 text-body text-text3">Loading history…</div>
        ) : history.length === 0 ? (
          <div className="px-5 py-6 text-body text-text3">
            No prior versions yet. Save a change to create the first history
            entry.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-0 [grid-template-rows:auto_1fr] md:[grid-template-columns:220px_1fr] md:[grid-template-rows:1fr]">
            <div className="max-h-[28vh] overflow-y-auto border-b border-border md:max-h-none md:border-b-0 md:border-r">
              {history.map((entry) => {
                const active = entry.version === selectedVersion;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedVersion(entry.version)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-3 text-left",
                      active
                        ? "bg-info-dim"
                        : "bg-transparent hover:bg-surface2",
                    )}
                  >
                    <span className="text-body font-semibold text-text1">
                      Version {entry.version}
                    </span>
                    <span className="text-micro text-text3">
                      {formatConfigSavedAt(entry.savedAt)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="text-caption text-text3">
                  {selected
                    ? `Comparing v${selected.version} → current v${current?.version ?? currentVersion ?? "—"}`
                    : "Select a version"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isLocked ||
                    rollingBack ||
                    !selected ||
                    currentVersion == null
                  }
                  onClick={() => void handleRollback()}
                >
                  {rollingBack ? "Rolling back…" : "Rollback"}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {diffs.length === 0 ? (
                  <div className="text-body text-text3">
                    Select a history entry to view the diff.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {diffs.map((diff) => (
                      <div
                        key={diff.section}
                        className={cn(
                          "rounded-xl border px-3 py-2.5",
                          diff.changed
                            ? "border-warning-border bg-surface2"
                            : "border-border bg-surface",
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-caption font-bold uppercase tracking-[0.3px] text-text2">
                            {diff.section}
                          </span>
                          <span
                            className={cn(
                              "text-micro font-semibold",
                              diff.changed ? "text-warning" : "text-text3",
                            )}
                          >
                            {diff.changed ? "Changed" : "Unchanged"}
                          </span>
                        </div>
                        {diff.changed ? (
                          <div className="grid gap-2 lg:grid-cols-2">
                            <pre className={diffPreClass}>{diff.before}</pre>
                            <pre className={diffPreClass}>{diff.after}</pre>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

const overlayClass =
  "fixed inset-0 z-[1100] flex justify-end bg-[rgba(0,0,0,0.45)]";
const backdropClass =
  "absolute inset-0 cursor-pointer border-none bg-transparent";
const panelClass =
  "relative z-[1] flex h-full w-full max-w-[920px] flex-col border-l border-border bg-surface shadow-[-12px_0_40px_rgba(0,0,0,0.25)]";
const closeButtonClass =
  "cursor-pointer rounded-lg border border-border bg-surface2 px-3 py-1.5 text-caption font-semibold text-text2";
const errorBannerClass =
  "mx-5 mt-3 rounded-sm border border-error-border bg-error-dim px-3.5 py-2.5 text-caption text-error";
const diffPreClass =
  "max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg p-2.5 text-micro leading-[1.45] text-text2";
