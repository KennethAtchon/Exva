import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";

export function RenameConversationDialog({
  open,
  initialTitle,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initialTitle: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);

  const submit = async () => {
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await onSubmit(next);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl border-border bg-surface p-5 sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-text1">
            Rename conversation
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Conversation title"
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!title.trim() || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
