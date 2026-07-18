import { useWorkspaceStore } from "@/store/workspaceStore";

export function AssistantRuntimeMeta() {
  const preferences = useWorkspaceStore((s) => s.preferences);
  const modelLabel = preferences
    ? `${preferences.defaultModelProviderKey} / ${preferences.defaultModelModelId}`
    : "Not configured";

  return (
    <div className="space-y-1.5 text-caption text-text2">
      <div>
        <span className="font-mono text-micro uppercase tracking-wider text-text3">
          Model
        </span>
        <p className="mt-0.5 break-all font-sans text-text1">{modelLabel}</p>
      </div>
    </div>
  );
}
