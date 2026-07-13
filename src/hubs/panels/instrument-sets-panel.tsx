import { useEffect, useReducer, useState } from "react";
import { instrumentSetsApi } from "@/lib/experience-catalog-api";
import { canonicalizeInstrumentId } from "@electron/shared/domain/experience-inputs/instrument-set";
import type { InstrumentSetMemberRef } from "@electron/shared/domain/experience-inputs/instrument-set";
import type { InstrumentSetRevision } from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentClass } from "@electron/shared/domain/enums";
import { Badge } from "@/components/custom-ui";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { EmptyState, SectionHeader } from "@/components/ui/primitives";
import { ShadcnSelect } from "@/components/custom-ui";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col gap-5">
      <SectionHeader
        eyebrow="Universes"
        title="Instrument sets"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            New set
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-sm border border-border bg-surface2"
            />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          message={error}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : sets.length === 0 ? (
        <EmptyState
          message="No instrument sets yet. Create a reusable list of instruments for scheduled scan strategies."
          actionLabel="New set"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sets.map((set) => (
            <SetCard
              key={`${set.setId}-${set.revision}`}
              set={set}
              onEdit={() => setEditTarget(set)}
            />
          ))}
        </div>
      )}

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

function SetCard({
  set,
  onEdit,
}: {
  set: InstrumentSetRevision;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapseAt = 12;
  const visibleMembers =
    expanded || set.members.length <= collapseAt
      ? set.members
      : set.members.slice(0, collapseAt);

  return (
    <article className="flex flex-col rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 truncate font-sans text-label text-text1">
            {set.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={classBadgeVariant(set.instrumentClass)} size="sm">
              {formatClass(set.instrumentClass)}
            </Badge>
            <Badge variant="default" size="sm">
              Rev {set.revision}
            </Badge>
            <Badge
              variant={
                set.status === "active"
                  ? "success"
                  : set.status === "draft"
                    ? "warn"
                    : "default"
              }
              size="sm"
            >
              {set.status}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {visibleMembers.map((m) => (
          <span key={m.canonicalId} className={memberChipClass}>
            {m.displaySymbol}
          </span>
        ))}
        {set.members.length > collapseAt && !expanded ? (
          <button
            type="button"
            className={cn(memberChipClass, "cursor-pointer hover:bg-surface3")}
            onClick={() => setExpanded(true)}
          >
            +{set.members.length - collapseAt} more
          </button>
        ) : null}
      </div>

      <div className="mt-auto font-mono text-caption text-text3">
        {set.members.length} instrument{set.members.length === 1 ? "" : "s"}
        {set.mode === "source_driven" ? " · source-driven" : null}
      </div>
    </article>
  );
}

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
      <DialogContent className="max-w-lg border-border bg-surface">
        <h3 className="m-0 font-sans text-head text-text1">
          New instrument set
        </h3>
        <div className="grid gap-3">
          <label className="grid gap-1.5 font-sans text-caption">
            <span className={labelClass}>Name</span>
            <input
              value={state.name}
              onChange={(e) => dispatch({ name: e.target.value })}
              placeholder="Core Equities"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1.5 font-sans text-caption">
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
          <label className="grid gap-1.5 font-sans text-caption">
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
          <div className="font-sans text-caption text-error">{state.error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !state.name.trim() || !state.membersText.trim() || state.saving
            }
            onClick={() => void save()}
          >
            {state.saving ? "Creating…" : "Create set"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogContent className="max-w-lg border-border bg-surface">
        <h3 className="m-0 font-sans text-head text-text1">
          Edit · {set.name}
        </h3>
        <p className="m-0 font-sans text-caption text-text3">
          Saving creates revision {set.revision} → {set.revision + 1}. Running
          sessions keep their pinned revision.
        </p>
        <div className="grid gap-3">
          <label className="grid gap-1.5 font-sans text-caption">
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
        </div>
        {state.error ? (
          <div className="font-sans text-caption text-error">{state.error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!state.membersText.trim() || state.saving}
            onClick={() => void save()}
          >
            {state.saving ? "Saving…" : "Save new revision"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatClass(cls: InstrumentClass): string {
  if (cls === "stock") return "Stocks";
  if (cls === "crypto") return "Crypto";
  if (cls === "futures") return "Futures";
  if (cls === "options") return "Options";
  return "Prediction";
}

function classBadgeVariant(
  cls: InstrumentClass,
): "default" | "blue" | "purple" | "success" {
  if (cls === "stock") return "blue";
  if (cls === "crypto") return "purple";
  if (cls === "futures") return "success";
  return "default";
}

const memberChipClass =
  "rounded-sm border border-border bg-surface2 px-2 py-0.5 font-mono text-micro text-text2";
const labelClass = "font-mono text-micro uppercase tracking-wider text-text3";
const inputClass =
  "rounded-sm border border-hairline bg-surface2 px-2.5 py-2 font-sans text-body text-text1";
const textareaClass =
  "w-full rounded-sm border border-hairline bg-surface2 px-2.5 py-2 font-sans text-body text-text1";
