import { useReducer, useState, type Reducer } from "react";
import type {
  AutopsyLesson,
  LessonCategory,
  LessonSeverity,
  LessonStatus,
} from "@/lib/autopsy-types";
import { confirm, focusRingClass } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Status + Severity colour maps
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<
  LessonStatus,
  { label: string; bg: string; color: string }
> = {
  pending: { label: "Pending", bg: "var(--surface3)", color: "var(--text3)" },
  implemented: {
    label: "Implemented",
    bg: "var(--color-info-dim)",
    color: "var(--color-info)",
  },
  validated: {
    label: "Validated",
    bg: "var(--color-success-dim)",
    color: "var(--color-success)",
  },
  recurring: {
    label: "Recurring",
    bg: "var(--color-warning-dim)",
    color: "var(--color-warning)",
  },
  dismissed: {
    label: "Dismissed",
    bg: "var(--surface3)",
    color: "var(--text2)",
  },
};

const SEVERITY_STYLE: Record<string, { dot: string; label: string }> = {
  low: { dot: "var(--text3)", label: "Low" },
  medium: { dot: "var(--color-info)", label: "Med" },
  high: { dot: "var(--color-warning)", label: "High" },
  critical: { dot: "var(--color-error)", label: "Crit" },
};

const STATUS_ORDER: LessonStatus[] = [
  "pending",
  "implemented",
  "validated",
  "recurring",
  "dismissed",
];

const LESSON_SEVERITIES: LessonSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

const LESSON_CATEGORIES: LessonCategory[] = [
  "strategy",
  "execution",
  "behavioral",
  "risk",
  "system",
];

const lessonChipClass =
  "rounded-[4px] bg-surface3 px-2 py-[2px] font-mono text-caption";

const statusPillButtonClass =
  "cursor-pointer rounded-sm border-none px-2.5 py-0.5 font-mono text-caption font-semibold tracking-[0.04em]";

const statusPickerContainerClass =
  "absolute right-0 top-[calc(100%+4px)] z-50 min-w-[140px] rounded-lg border border-border bg-surface3 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]";

const statusPickerButtonClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md border-none px-[10px] py-1.5 text-left";

const addLessonButtonClass =
  "rounded-sm border border-border bg-transparent px-2.5 py-0.5 text-caption text-text2";

const inputClass =
  "w-full resize-y rounded-md border border-border bg-surface px-[10px] py-2 font-sans text-caption text-text1";

const secondaryButtonClass =
  "cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 text-caption text-text2";

const primaryButtonClass =
  "cursor-pointer rounded-md border border-info-border bg-info-dim px-3 py-1.5 text-caption text-info";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatusPicker({
  current,
  onSelect,
  onClose,
}: {
  current: LessonStatus;
  onSelect: (s: LessonStatus) => void;
  onClose: () => void;
}) {
  return (
    <div className={statusPickerContainerClass}>
      {STATUS_ORDER.map((s) => {
        const st = STATUS_STYLE[s];
        return (
          <button
            key={s}
            onClick={() => {
              onSelect(s);
              onClose();
            }}
            className={statusPickerButtonClass}
            style={{
              background: s === current ? "var(--surface2)" : "transparent",
            }}
          >
            <span
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: st.color }}
            />
            <span className="text-caption text-text1">{st.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LessonRow({
  lesson,
  onStatusChange,
  onPromoteLesson,
  promoteSessionId,
}: {
  lesson: AutopsyLesson;
  onStatusChange: (id: string, status: LessonStatus) => void;
  onPromoteLesson?: (
    lessonId: string,
    targetScope: "global" | "session",
    targetSessionId?: string,
  ) => void | Promise<void>;
  promoteSessionId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const st = STATUS_STYLE[lesson.status] ?? STATUS_STYLE.pending;
  const sev = SEVERITY_STYLE[lesson.severity] ?? SEVERITY_STYLE.medium;

  return (
    <div className="overflow-visible rounded-lg border border-border bg-surface2">
      {/* Header row */}
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer px-[12px] pb-2 pt-[10px]"
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((e) => !e);
          }
        }}
      >
        {/* Chips row */}
        <div className="mb-1.5 flex items-center gap-1.5">
          {/* Severity dot + label */}
          <span
            className={cn(
              lessonChipClass,
              "inline-flex items-center gap-1 font-semibold tracking-[0.04em]",
            )}
            style={{ color: sev.dot }}
          >
            <span
              className="size-[5px] rounded-full"
              style={{ background: sev.dot }}
            />
            {sev.label}
          </span>

          {/* Category */}
          <span
            className={cn(
              lessonChipClass,
              "uppercase tracking-[0.05em] text-text3",
            )}
          >
            {lesson.category}
          </span>

          <span
            className={cn(
              lessonChipClass,
              "uppercase tracking-[0.05em]",
              lesson.source === "period" && "bg-info-dim text-info",
              lesson.source === "manual" && "bg-success-dim text-success",
              lesson.source === "trade" && "bg-surface3 text-text3",
            )}
          >
            {lesson.source}
          </span>

          {/* Recurrence badge */}
          {lesson.recurrenceCount > 0 && (
            <span
              className={cn(lessonChipClass, "bg-warning-dim text-warning")}
            >
              ×{lesson.recurrenceCount}
            </span>
          )}
        </div>

        {/* Lesson text */}
        <div
          className={cn(
            "text-caption leading-[1.55] text-text1",
            !expanded && "line-clamp-2",
          )}
        >
          {lesson.lesson}
        </div>
      </div>

      {/* Proposed fix (expanded) */}
      {expanded && lesson.proposedFix && (
        <div className="mt-0.5 border-t border-border px-3 pb-2.5 pt-2">
          <div className="mb-[5px] text-caption font-semibold uppercase tracking-[0.07em] text-text3">
            Proposed Fix
          </div>
          <div className="text-caption leading-[1.55] text-text2">
            {lesson.proposedFix}
          </div>
        </div>
      )}

      {/* Footer: status chip */}
      <div className="relative flex flex-wrap items-center justify-end gap-2 px-2.5 pb-2.5">
        {lesson.source === "trade" && onPromoteLesson ? (
          <>
            {promoteSessionId ? (
              <button
                type="button"
                className={`rounded-sm border border-border bg-transparent px-2.5 py-0.5 text-caption text-text2 ${focusRingClass}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void (async () => {
                    const ok = await confirm({
                      title: "Promote to session ledger?",
                      description:
                        "Add to the session lesson ledger? This lesson will appear in future period autopsies.",
                      confirmLabel: "Promote",
                    });
                    if (!ok) return;
                    void onPromoteLesson(
                      lesson.id,
                      "session",
                      promoteSessionId,
                    );
                  })();
                }}
              >
                Promote → Session
              </button>
            ) : null}
            <button
              type="button"
              className={`rounded-sm border border-border bg-transparent px-2.5 py-0.5 text-caption text-text2 ${focusRingClass}`}
              onClick={(event) => {
                event.stopPropagation();
                void (async () => {
                  const ok = await confirm({
                    title: "Promote to global ledger?",
                    description:
                      "Add to the global lesson ledger? This lesson will appear in future period autopsies.",
                    confirmLabel: "Promote",
                  });
                  if (!ok) return;
                  void onPromoteLesson(lesson.id, "global");
                })();
              }}
            >
              Promote → Global
            </button>
          </>
        ) : null}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((o) => !o);
            }}
            className={statusPillButtonClass}
            style={{ background: st.bg, color: st.color }}
          >
            {st.label} ▾
          </button>
          {pickerOpen && (
            <>
              {/* Backdrop */}
              <div
                role="button"
                tabIndex={0}
                className="fixed inset-0 z-[49]"
                onClick={() => setPickerOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPickerOpen(false);
                  }
                }}
              />
              <StatusPicker
                current={lesson.status}
                onSelect={(s) => onStatusChange(lesson.id, s)}
                onClose={() => setPickerOpen(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LessonsPanel
// ---------------------------------------------------------------------------

interface LessonFormState {
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
  error: string | null;
}

interface LessonUiState {
  adding: boolean;
  submitting: boolean;
}

function mergeReducer<S>(state: S, update: Partial<S>): S {
  return { ...state, ...update };
}

const formInit: LessonFormState = {
  lesson: "",
  severity: "medium",
  category: "strategy",
  proposedFix: "",
  error: null,
};

const uiInit: LessonUiState = {
  adding: false,
  submitting: false,
};

export function LessonsPanel({
  lessons,
  onStatusChange,
  onAddLesson,
  onPromoteLesson,
  promoteSessionId,
}: {
  lessons: AutopsyLesson[];
  onStatusChange: (id: string, status: LessonStatus) => void;
  onAddLesson?: (draft: {
    lesson: string;
    severity: LessonSeverity;
    category: LessonCategory;
    proposedFix: string;
  }) => Promise<void> | void;
  onPromoteLesson?: (
    lessonId: string,
    targetScope: "global" | "session",
    targetSessionId?: string,
  ) => Promise<void> | void;
  promoteSessionId?: string | null;
}) {
  const [form, dispatchForm] = useReducer<
    Reducer<LessonFormState, Partial<LessonFormState>>
  >(mergeReducer, formInit);
  const [ui, dispatchUi] = useReducer<
    Reducer<LessonUiState, Partial<LessonUiState>>
  >(mergeReducer, uiInit);
  const { lesson, severity, category, proposedFix, error } = form;
  const { adding, submitting } = ui;

  const resetForm = () => {
    dispatchForm(formInit);
  };

  const submitLesson = async () => {
    if (!onAddLesson) return;
    if (!lesson.trim()) {
      dispatchForm({ error: "Lesson text is required." });
      return;
    }
    dispatchUi({ submitting: true });
    dispatchForm({ error: null });
    try {
      await onAddLesson({
        lesson: lesson.trim(),
        severity,
        category,
        proposedFix: proposedFix.trim(),
      });
      resetForm();
      dispatchUi({ adding: false });
    } catch (err) {
      dispatchForm({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      dispatchUi({ submitting: false });
    }
  };

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
        <span className="text-caption font-bold uppercase tracking-[0.1em] text-text3">
          Lessons
        </span>
        <button
          onClick={() => {
            const next = !adding;
            if (!next) resetForm();
            dispatchUi({ adding: next });
          }}
          className={cn(
            addLessonButtonClass,
            onAddLesson
              ? "cursor-pointer opacity-100"
              : "cursor-not-allowed opacity-[0.55]",
          )}
          disabled={!onAddLesson}
        >
          + Add
        </button>
      </div>

      {adding && onAddLesson && (
        <div className="flex flex-col gap-2.5 border-b border-border bg-surface2 px-3.5 py-3">
          <textarea
            value={lesson}
            onChange={(e) => dispatchForm({ lesson: e.target.value })}
            placeholder="Add the lesson to track"
            rows={3}
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={severity}
              onChange={(e) =>
                dispatchForm({ severity: e.target.value as LessonSeverity })
              }
              className={inputClass}
            >
              {LESSON_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) =>
                dispatchForm({ category: e.target.value as LessonCategory })
              }
              className={inputClass}
            >
              {LESSON_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={proposedFix}
            onChange={(e) => dispatchForm({ proposedFix: e.target.value })}
            placeholder="Optional proposed fix"
            rows={2}
            className={inputClass}
          />
          {error && (
            <div className="text-caption leading-normal text-error">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                resetForm();
                dispatchUi({ adding: false });
              }}
              className={secondaryButtonClass}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void submitLesson();
              }}
              className={primaryButtonClass}
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save Lesson"}
            </button>
          </div>
        </div>
      )}

      {/* Lesson list */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {lessons.length === 0 ? (
          <div className="py-5 text-center text-caption text-text3">
            No lessons extracted.
          </div>
        ) : (
          lessons.map((l) => (
            <LessonRow
              key={l.id}
              lesson={l}
              onStatusChange={onStatusChange}
              onPromoteLesson={onPromoteLesson}
              promoteSessionId={promoteSessionId}
            />
          ))
        )}
      </div>
    </div>
  );
}
