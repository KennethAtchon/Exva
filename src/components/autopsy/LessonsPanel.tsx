import { useState } from "react";
import type {
  AutopsyLesson,
  LessonCategory,
  LessonSeverity,
  LessonStatus,
} from "@/lib/autopsy-types";

// ---------------------------------------------------------------------------
// Status + Severity colour maps
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<
  LessonStatus,
  { label: string; bg: string; color: string }
> = {
  pending: { label: "Pending", bg: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  implemented: {
    label: "Implemented",
    bg: "rgba(96,165,250,0.15)",
    color: "#60a5fa",
  },
  validated: {
    label: "Validated",
    bg: "rgba(52,211,153,0.15)",
    color: "#34d399",
  },
  recurring: {
    label: "Recurring",
    bg: "rgba(251,191,36,0.15)",
    color: "#fbbf24",
  },
  dismissed: {
    label: "Dismissed",
    bg: "rgba(100,116,139,0.12)",
    color: "#64748b",
  },
};

const SEVERITY_STYLE: Record<
  string,
  { dot: string; label: string }
> = {
  low: { dot: "#4a5a6a", label: "Low" },
  medium: { dot: "#60a5fa", label: "Med" },
  high: { dot: "#fbbf24", label: "High" },
  critical: { dot: "#f87171", label: "Crit" },
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
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 50,
        background: "var(--surface3)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 4,
        minWidth: 140,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {STATUS_ORDER.map((s) => {
        const st = STATUS_STYLE[s];
        return (
          <button
            key={s}
            onClick={() => {
              onSelect(s);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              background: s === current ? "var(--surface2)" : "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: st.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: "var(--text1)" }}>
              {st.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LessonRow({
  lesson,
  onStatusChange,
}: {
  lesson: AutopsyLesson;
  onStatusChange: (id: string, status: LessonStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const st = STATUS_STYLE[lesson.status] ?? STATUS_STYLE.pending;
  const sev = SEVERITY_STYLE[lesson.severity] ?? SEVERITY_STYLE.medium;

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface2)",
        overflow: "visible",
      }}
    >
      {/* Header row */}
      <div
        style={{
          padding: "10px 12px 8px",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Chips row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
          }}
        >
          {/* Severity dot + label */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 4,
              background: "var(--surface3)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: sev.dot,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: sev.dot,
              }}
            />
            {sev.label}
          </span>

          {/* Category */}
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              background: "var(--surface3)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {lesson.category}
          </span>

          {/* Recurrence badge */}
          {lesson.recurrenceCount > 0 && (
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 4,
                background: "rgba(251,191,36,0.12)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "#fbbf24",
              }}
            >
              ×{lesson.recurrenceCount}
            </span>
          )}
        </div>

        {/* Lesson text */}
        <div
          style={{
            fontSize: 12,
            color: "var(--text1)",
            lineHeight: 1.55,
            display: "-webkit-box",
            WebkitLineClamp: expanded ? "unset" : 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: expanded ? "visible" : "hidden",
          }}
        >
          {lesson.lesson}
        </div>
      </div>

      {/* Proposed fix (expanded) */}
      {expanded && lesson.proposedFix && (
        <div
          style={{
            padding: "0 12px 10px",
            borderTop: "1px solid var(--border)",
            marginTop: 2,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 5,
              fontWeight: 600,
            }}
          >
            Proposed Fix
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text2)",
              lineHeight: 1.55,
            }}
          >
            {lesson.proposedFix}
          </div>
        </div>
      )}

      {/* Footer: status chip */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "0 10px 10px",
          position: "relative",
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((o) => !o);
            }}
            style={{
              padding: "3px 9px",
              borderRadius: 5,
              border: "none",
              background: st.bg,
              color: st.color,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {st.label} ▾
          </button>
          {pickerOpen && (
            <>
              {/* Backdrop */}
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 49,
                }}
                onClick={() => setPickerOpen(false)}
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

export function LessonsPanel({
  lessons,
  onStatusChange,
  onAddLesson,
}: {
  lessons: AutopsyLesson[];
  onStatusChange: (id: string, status: LessonStatus) => void;
  onAddLesson?: (draft: {
    lesson: string;
    severity: LessonSeverity;
    category: LessonCategory;
    proposedFix: string;
  }) => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lesson, setLesson] = useState("");
  const [severity, setSeverity] = useState<LessonSeverity>("medium");
  const [category, setCategory] = useState<LessonCategory>("strategy");
  const [proposedFix, setProposedFix] = useState("");

  const resetForm = () => {
    setLesson("");
    setSeverity("medium");
    setCategory("strategy");
    setProposedFix("");
    setError(null);
  };

  const submitLesson = async () => {
    if (!onAddLesson) return;
    if (!lesson.trim()) {
      setError("Lesson text is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAddLesson({
        lesson: lesson.trim(),
        severity,
        category,
        proposedFix: proposedFix.trim(),
      });
      resetForm();
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--text3)",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Lessons
        </span>
        <button
          onClick={() => {
            setAdding((open) => {
              const next = !open;
              if (!next) resetForm();
              return next;
            });
          }}
          style={{
            padding: "3px 9px",
            borderRadius: 5,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text2)",
            fontSize: 11,
            cursor: onAddLesson ? "pointer" : "not-allowed",
            opacity: onAddLesson ? 1 : 0.55,
          }}
          disabled={!onAddLesson}
        >
          + Add
        </button>
      </div>

      {adding && onAddLesson && (
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "var(--surface2)",
          }}
        >
          <textarea
            value={lesson}
            onChange={(e) => setLesson(e.target.value)}
            placeholder="Add the lesson to track"
            rows={3}
            style={inputStyle}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as LessonSeverity)}
              style={inputStyle}
            >
              {LESSON_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as LessonCategory)}
              style={inputStyle}
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
            onChange={(e) => setProposedFix(e.target.value)}
            placeholder="Optional proposed fix"
            rows={2}
            style={inputStyle}
          />
          {error && (
            <div style={{ fontSize: 11, color: "#fca5a5", lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={() => {
                resetForm();
                setAdding(false);
              }}
              style={secondaryButtonStyle}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void submitLesson();
              }}
              style={primaryButtonStyle}
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save Lesson"}
            </button>
          </div>
        </div>
      )}

      {/* Lesson list */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {lessons.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "20px 0",
              fontSize: 12,
              color: "var(--text3)",
            }}
          >
            No lessons extracted.
          </div>
        ) : (
          lessons.map((l) => (
            <LessonRow key={l.id} lesson={l} onStatusChange={onStatusChange} />
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text1)",
  fontSize: 12,
  fontFamily: "var(--font-sans)",
  resize: "vertical" as const,
};

const secondaryButtonStyle = {
  padding: "7px 11px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 12,
  cursor: "pointer",
};

const primaryButtonStyle = {
  padding: "7px 11px",
  borderRadius: 6,
  border: "1px solid rgba(96,165,250,0.4)",
  background: "rgba(96,165,250,0.15)",
  color: "#60a5fa",
  fontSize: 12,
  cursor: "pointer",
};
