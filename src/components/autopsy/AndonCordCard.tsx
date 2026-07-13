import { Button } from "@/components/ui";
import type { AutopsyLesson } from "@/lib/autopsy-types";

export function AndonCordCard({
  lessons,
  onDismiss,
}: {
  lessons: AutopsyLesson[];
  onDismiss: (lessonId: string) => void | Promise<void>;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text1">
        Andon Cord
      </div>
      <div className="px-4 py-4">
        {lessons.length === 0 ? (
          <div className="text-sm text-text3">
            No Andon Cord events for this scope.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lessons.map((lesson) => (
              <div
                key={lesson.id}
                className="rounded-xl border border-warning-border bg-warning-dim px-4 py-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs uppercase">
                  <span className="rounded-full bg-error-dim px-2 py-1 text-error">
                    {lesson.severity}
                  </span>
                  <span className="rounded-full bg-surface px-2 py-1 text-text3">
                    recurred {lesson.recurrenceCount} times
                  </span>
                </div>
                <div className="text-sm text-text1">{lesson.lesson}</div>
                <div className="mt-2 text-xs text-text3">
                  Fired {new Date(lesson.updatedAt).toLocaleString()}
                </div>
                <div className="mt-3">
                  <Button
                    variant="outline"
                    className="h-8 border-warning-border bg-transparent px-3 text-xs text-warning"
                    onClick={() => void onDismiss(lesson.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
