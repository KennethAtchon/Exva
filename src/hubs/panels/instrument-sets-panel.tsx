import { useEffect, useReducer, useState } from "react";
import { instrumentSetsApi } from "@/lib/experience-catalog-api";
import { canonicalizeInstrumentId } from "@electron/shared/domain/experience-inputs/instrument-set";
import type { InstrumentSetMemberRef } from "@electron/shared/domain/experience-inputs/instrument-set";
import type { InstrumentSetRevision } from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentClass } from "@electron/shared/domain/enums";
import { Card } from "@/components/custom-ui";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { ShadcnSelect } from "@/components/custom-ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InstrumentSetsPage() {
  const [sets, setSets] = useState<InstrumentSetRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<InstrumentSetRevision | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { sets: next } = await instrumentSetsApi.list();
      setSets(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load instrument sets.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="hub-panel-body flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
            CONFIGURATION
          </div>
          <h1 className="m-0 mt-2.5 text-[28px]">Instrument Sets</h1>
          <p className="mt-2 text-[13px] text-[var(--text3)]">
            Reusable groups of instruments for scheduled scan strategies.
            Sessions pin to a specific revision so changes don&apos;t affect
            running sessions.
          </p>
        </div>
        <Button
          className="shrink-0 bg-[var(--accent)] text-white"
          onClick={() => setCreateOpen(true)}
        >
          New Set
        </Button>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="grid gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface2)]"
              />
            ))}
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-error-border bg-error-dim px-3 py-2 text-[13px] text-error">
            {error}{" "}
            <button
              className="underline"
              onClick={() => void load()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : sets.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-[var(--border)] p-6 text-[13px] text-[var(--text3)]">
            <div className="mb-2 font-medium text-[var(--text1)]">
              No instrument sets yet
            </div>
            <p className="m-0 leading-relaxed">
              Create a set to define a reusable list of instruments for
              scheduled scan strategies. Sessions subscribe to a specific
              revision of a set.
            </p>
          </div>
        ) : (
          sets.map((set) => (
            <SetRow
              key={`${set.setId}-${set.revision}`}
              set={set}
              onEdit={() => setEditTarget(set)}
            />
          ))
        )}
      </Card>

      <CreateSetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
      <EditSetDialog
        set={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSaved={() => {
          setEditTarget(null);
          void load();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function SetRow({
  set,
  onEdit,
}: {
  set: InstrumentSetRevision;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const COLLAPSE_AT = 8;
  const visibleMembers =
    expanded || set.members.length <= COLLAPSE_AT
      ? set.members
      : set.members.slice(0, COLLAPSE_AT);

  return (
    <div className="flex items-start gap-4 border-b border-[var(--border)] p-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text1)]">
            {set.name}
          </span>
          <span className={classChipClass(set.instrumentClass)}>
            {formatClass(set.instrumentClass)}
          </span>
          <span className="rounded-full border border-[var(--border)] px-2 py-[2px] text-[11px] text-[var(--text3)]">
            Rev {set.revision}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-[2px] text-[11px]",
              set.status === "active"
                ? "border-success-border bg-success-dim text-success"
                : set.status === "draft"
                  ? "border-warning-border bg-warning-dim text-warning"
                  : "border-[var(--border)] text-[var(--text3)]",
            )}
          >
            {set.status}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {visibleMembers.map((m) => (
            <span key={m.canonicalId} className={memberChipClass}>
              {m.displaySymbol}
            </span>
          ))}
          {set.members.length > COLLAPSE_AT && !expanded ? (
            <button
              type="button"
              className={memberChipClass + " cursor-pointer"}
              onClick={() => setExpanded(true)}
            >
              +{set.members.length - COLLAPSE_AT} more
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 text-[12px] text-[var(--text3)]">
          {set.members.length} instrument{set.members.length === 1 ? "" : "s"}
          {set.mode === "source_driven" ? " · source-driven universe" : null}
        </div>
        {set.status !== "active" ? (
          <div className="mt-1 text-[12px] text-[var(--text3)]">
            Research note: strategies validated on a specific universe.
            Instruments added here may not carry the same evidence base.
          </div>
        ) : null}
      </div>
      <Button
        variant="outline"
        className="shrink-0 h-8 text-xs"
        onClick={onEdit}
      >
        Edit
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

type CreateState = {
  name: string;
  instrumentClass: InstrumentClass;
  membersText: string;
  saving: boolean;
  error: string | null;
};

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

function CreateSetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [state, dispatch] = useReducer(mergeReducer<CreateState>, {
    name: "",
    instrumentClass: "stock",
    membersText: "",
    saving: false,
    error: null,
  });

  useEffect(() => {
    if (!open) {
      dispatch({
        name: "",
        instrumentClass: "stock",
        membersText: "",
        saving: false,
        error: null,
      });
    }
  }, [open]);

  const parseMembers = (): InstrumentSetMemberRef[] => {
    return state.membersText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((raw) => {
        const sym = canonicalizeInstrumentId(raw, state.instrumentClass);
        return { canonicalId: sym, displaySymbol: sym, venue: null };
      });
  };

  const save = async () => {
    dispatch({ saving: true, error: null });
    try {
      const members = parseMembers();
      await instrumentSetsApi.createRevision({
        name: state.name.trim(),
        instrumentClass: state.instrumentClass,
        members,
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      dispatch({
        error: err instanceof Error ? err.message : "Failed to create set.",
        saving: false,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] border-border bg-[var(--surface)]">
        <h3 className="m-0 text-[17px] font-semibold">New Instrument Set</h3>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[12px]">
            <span className={labelClass}>Name</span>
            <input
              value={state.name}
              onChange={(e) => dispatch({ name: e.target.value })}
              placeholder="Core Equities"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1.5 text-[12px]">
            <span className={labelClass}>Instrument class</span>
            <ShadcnSelect
              value={state.instrumentClass}
              onValueChange={(v) =>
                dispatch({ instrumentClass: v as InstrumentClass })
              }
              options={[
                { value: "stock", label: "Stocks / ETFs" },
                { value: "crypto", label: "Crypto" },
                { value: "futures", label: "Futures" },
                { value: "options", label: "Options" },
              ]}
            />
          </label>
          <label className="grid gap-1.5 text-[12px]">
            <span className={labelClass}>
              Instruments (comma or newline separated)
            </span>
            <textarea
              value={state.membersText}
              onChange={(e) => dispatch({ membersText: e.target.value })}
              rows={5}
              placeholder={"SPY\nQQQ\nNVDA"}
              className={textareaClass}
            />
          </label>
        </div>
        {state.error ? (
          <div className="text-[12px] text-error">{state.error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[var(--accent)] text-white"
            disabled={
              !state.name.trim() || !state.membersText.trim() || state.saving
            }
            onClick={() => void save()}
          >
            {state.saving ? "Creating..." : "Create Set"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

type EditState = {
  membersText: string;
  saving: boolean;
  error: string | null;
};

function EditSetDialog({
  set,
  onOpenChange,
  onSaved,
}: {
  set: InstrumentSetRevision | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [state, dispatch] = useReducer(mergeReducer<EditState>, {
    membersText: "",
    saving: false,
    error: null,
  });

  useEffect(() => {
    if (set) {
      dispatch({
        membersText: set.members.map((m) => m.displaySymbol).join("\n"),
        saving: false,
        error: null,
      });
    }
  }, [set]);

  if (!set) return null;

  const parseMembers = (): InstrumentSetMemberRef[] => {
    return state.membersText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((raw) => {
        const sym = canonicalizeInstrumentId(raw, set.instrumentClass);
        return { canonicalId: sym, displaySymbol: sym, venue: null };
      });
  };

  const save = async () => {
    dispatch({ saving: true, error: null });
    try {
      const members = parseMembers();
      await instrumentSetsApi.createRevision({
        setId: set.setId,
        name: set.name,
        instrumentClass: set.instrumentClass,
        members,
      });
      onSaved();
    } catch (err) {
      dispatch({
        error: err instanceof Error ? err.message : "Failed to save.",
        saving: false,
      });
    }
  };

  return (
    <Dialog open={Boolean(set)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] border-border bg-[var(--surface)]">
        <h3 className="m-0 text-[17px] font-semibold">Edit — {set.name}</h3>
        <p className="m-0 text-[12px] text-[var(--text3)]">
          Saving creates a new revision ({set.revision} → {set.revision + 1}).
          Running sessions will continue using the revision they were created
          with.
        </p>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[12px]">
            <span className={labelClass}>
              Instruments (comma or newline separated)
            </span>
            <textarea
              value={state.membersText}
              onChange={(e) => dispatch({ membersText: e.target.value })}
              rows={8}
              className={textareaClass}
            />
          </label>
          <div className="text-[12px] text-[var(--text3)]">
            Class: {formatClass(set.instrumentClass)} · Mode: {set.mode}
          </div>
          {set.status !== "active" ? (
            <div className="rounded-lg border border-warning-border bg-warning-dim px-3 py-2 text-[12px] text-warning">
              Research note: strategies were validated on the original
              instrument universe. Adding instruments here may yield different
              results from backtests.
            </div>
          ) : null}
        </div>
        {state.error ? (
          <div className="text-[12px] text-error">{state.error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[var(--accent)] text-white"
            disabled={!state.membersText.trim() || state.saving}
            onClick={() => void save()}
          >
            {state.saving ? "Saving..." : "Save New Revision"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatClass(cls: InstrumentClass): string {
  return cls === "stock"
    ? "Stocks"
    : cls === "crypto"
      ? "Crypto"
      : cls === "futures"
        ? "Futures"
        : cls === "options"
          ? "Options"
          : "Prediction Markets";
}

function classChipClass(cls: InstrumentClass): string {
  const base = "rounded-full border px-2 py-[2px] text-[11px] font-medium";
  if (cls === "stock")
    return `${base} border-info-border bg-info-dim text-info`;
  if (cls === "crypto")
    return `${base} border-market-border bg-market-dim text-market`;
  return `${base} border-[var(--border)] text-[var(--text2)]`;
}

const memberChipClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2 py-[3px] font-mono text-[11px] text-[var(--text2)]";

const labelClass =
  "inline-flex items-center gap-1 uppercase tracking-[0.08em] text-[var(--text3)]";
const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-[13px] text-[var(--text1)]";
const textareaClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-[13px] text-[var(--text1)]";
