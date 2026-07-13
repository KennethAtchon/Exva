import { useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import type {
  AutopsyLesson,
  LessonCategory,
  LessonSeverity,
  LessonStatus,
} from "@/lib/autopsy-types";
import { cn } from "@/lib/utils";

type LessonTab = "new" | "open" | "resolved";

const STATUS_OPTIONS: LessonStatus[] = [
  "pending",
  "implemented",
  "validated",
  "recurring",
  "dismissed",
];

const CATEGORY_OPTIONS: LessonCategory[] = [
  "strategy",
  "execution",
  "behavioral",
  "risk",
  "system",
];

const SEVERITY_OPTIONS: LessonSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

const statusTone: Record<LessonStatus, string> = {
  pending: "border-border bg-[var(--surface2)] text-[var(--text2)]",
  implemented: "border-info-border bg-info-dim text-info",
  validated: "border-success-border bg-success-dim text-success",
  recurring: "border-warning-border bg-warning-dim text-warning",
  dismissed: "border-border bg-[var(--surface2)] text-[var(--text3)]",
};

const severityTone: Record<LessonSeverity, string> = {
  low: "bg-[var(--surface2)] text-[var(--text3)]",
  medium: "bg-info-dim text-info",
  high: "bg-warning-dim text-warning",
  critical: "bg-error-dim text-error",
};

const sourceTone: Record<AutopsyLesson["source"], string> = {
  trade: "bg-[var(--surface2)] text-[var(--text3)]",
  period: "bg-info-dim text-info",
  manual: "bg-success-dim text-success",
};

export function PeriodLessonsPanel({
  lessons,
  currentPeriodAutopsyId,
  onStatusChange,
  onAddLesson,
}: {
  lessons: AutopsyLesson[];
  currentPeriodAutopsyId: string | null;
  onStatusChange: (
    lessonId: string,
    status: LessonStatus,
  ) => void | Promise<void>;
  onAddLesson: (draft: {
    lesson: string;
    severity: LessonSeverity;
    category: LessonCategory;
    proposedFix: string;
  }) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<LessonTab>("new");
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    lesson: "",
    severity: "medium" as LessonSeverity,
    category: "strategy" as LessonCategory,
    proposedFix: "",
  });

  const groups = useMemo(() => {
    const newLessons = currentPeriodAutopsyId
      ? lessons.filter((lesson) => lesson.autopsyId === currentPeriodAutopsyId)
      : [];
    const openLessons = lessons.filter(
      (lesson) =>
        lesson.status !== "validated" && lesson.status !== "dismissed",
    );
    const resolvedLessons = lessons.filter(
      (lesson) =>
        lesson.status === "validated" || lesson.status === "dismissed",
    );
    return {
      new: newLessons,
      open: openLessons,
      resolved: resolvedLessons,
    };
  }, [currentPeriodAutopsyId, lessons]);

  const visibleLessons = groups[tab];

  async function submitLesson() {
    if (form.lesson.trim().length < 10) {
      setError("Lesson text must be at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAddLesson({
        lesson: form.lesson.trim(),
        severity: form.severity,
        category: form.category,
        proposedFix: form.proposedFix.trim(),
      });
      setForm({
        lesson: "",
        severity: "medium",
        category: "strategy",
        proposedFix: "",
      });
      setAdding(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          LESSONS
        </div>
        <Button
          variant="outline"
          className="h-8 rounded-md border-border bg-transparent px-3 text-xs text-[var(--text2)]"
          onClick={() => setAdding((current) => !current)}
        >
          + Add Lesson
        </Button>
      </div>

      <div className="flex gap-2 border-b border-border px-4 py-3">
        {(
          [
            ["new", groups.new.length],
            ["open", groups.open.length],
            ["resolved", groups.resolved.length],
          ] as Array<[LessonTab, number]>
        ).map(([value, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium capitalize",
              tab === value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-[var(--surface2)] text-[var(--text2)]",
            )}
          >
            {value} ({count})
          </button>
        ))}
      </div>

      {adding ? (
        <div className="border-b border-border bg-[var(--surface2)] px-4 py-4">
          <div className="flex flex-col gap-3">
            <textarea
              value={form.lesson}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  lesson: event.target.value,
                }))
              }
              rows={3}
              placeholder="Lesson text"
              className="w-full rounded-md border border-border bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text1)]"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={form.severity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    severity: event.target.value as LessonSeverity,
                  }))
                }
                className="h-10 rounded-md border border-border bg-[var(--surface)] px-3 text-sm text-[var(--text1)]"
              >
                {SEVERITY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value as LessonCategory,
                  }))
                }
                className="h-10 rounded-md border border-border bg-[var(--surface)] px-3 text-sm text-[var(--text1)]"
              >
                {CATEGORY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <Input
              value={form.proposedFix}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  proposedFix: event.target.value,
                }))
              }
              placeholder="Proposed fix"
              className="border-border bg-[var(--surface)] text-[var(--text1)]"
            />
            {error ? <div className="text-xs text-error">{error}</div> : null}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-9 border-border bg-transparent px-3 text-xs text-[var(--text2)]"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-9 px-3 text-xs"
                disabled={submitting}
                onClick={() => void submitLesson()}
              >
                {submitting ? "Saving..." : "Add Lesson"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-4 py-4">
        {visibleLessons.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-[var(--text3)]">
            No lessons in this tab.
          </div>
        ) : (
          visibleLessons.map((lesson) => (
            <div
              key={lesson.id}
              className="rounded-xl border border-border bg-[var(--surface2)] px-4 py-3"
            >
              <div className="mb-2 flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-1 text-[11px] font-medium uppercase",
                    severityTone[lesson.severity],
                  )}
                >
                  {lesson.severity}
                </span>
                <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] uppercase text-[var(--text3)]">
                  {lesson.category}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-1 text-[11px] uppercase",
                    sourceTone[lesson.source],
                  )}
                >
                  {lesson.source}
                </span>
                {lesson.recurrenceCount > 0 ? (
                  <span className="rounded-full bg-warning-dim px-2 py-1 text-[11px] text-warning">
                    x{lesson.recurrenceCount}
                  </span>
                ) : null}
              </div>
              <div className="text-sm text-[var(--text1)]">{lesson.lesson}</div>
              {lesson.proposedFix ? (
                <div className="mt-2 text-xs text-[var(--text3)]">
                  Proposed fix: {lesson.proposedFix}
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--text3)]">
                  Updated {new Date(lesson.updatedAt).toLocaleString()}
                </div>
                <select
                  value={lesson.status}
                  onChange={(event) =>
                    void onStatusChange(
                      lesson.id,
                      event.target.value as LessonStatus,
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs capitalize",
                    statusTone[lesson.status],
                  )}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
