import { useWorkspaceStore } from "@/store/workspaceStore";
import { useControlStore } from "@/store/controlStore";

export function AssistantRuntimeMeta() {
  const preferences = useWorkspaceStore((s) => s.preferences);
  const autoApproveTools = useControlStore((s) => s.autoApproveTools);
  const setAutoApproveTools = useControlStore((s) => s.setAutoApproveTools);
  const modelLabel = preferences
    ? `${preferences.defaultModelProviderKey} / ${preferences.defaultModelModelId}`
    : "Not configured";

  return (
    <div className="space-y-3 text-caption text-text2">
      <div>
        <span className="font-mono text-micro uppercase tracking-wider text-text3">
          Model
        </span>
        <p className="mt-0.5 break-all font-sans text-text1">{modelLabel}</p>
      </div>

      <div className="border-t border-hairline pt-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-info"
            checked={autoApproveTools}
            onChange={(e) => setAutoApproveTools(e.target.checked)}
          />
          <span>
            <span className="block font-sans font-medium text-text1">
              Bypass all questions
            </span>
            <span className="mt-0.5 block text-micro text-text3">
              Auto-approve actions the assistant would normally pause to confirm.
              Live (real-money) actions still ask.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
