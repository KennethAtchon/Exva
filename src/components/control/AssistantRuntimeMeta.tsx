import { Badge } from "@/components/ui";
import { useWorkspaceStore } from "@/store/workspaceStore";

export function AssistantRuntimeMeta() {
  const preferences = useWorkspaceStore((s) => s.preferences);
  const modelLabel = preferences
    ? `${preferences.defaultModelProviderKey} / ${preferences.defaultModelModelId}`
    : "Not configured";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="font-normal text-[11px]">
        Model {modelLabel}
      </Badge>
      <Badge variant="outline" className="font-normal text-[11px]">
        Web search off
      </Badge>
    </div>
  );
}
