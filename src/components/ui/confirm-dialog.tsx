"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  confirming?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  confirming = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm border-border bg-surface p-5 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-head text-text1">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-body text-text2">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type TextInputDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, confirm stays disabled until the input matches exactly. */
  matchValue?: string;
  onSubmit: (value: string) => void;
  submitting?: boolean;
};

export function TextInputDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  defaultValue = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  matchValue,
  onSubmit,
  submitting = false,
}: TextInputDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const trimmed = value.trim();
  const canSubmit =
    trimmed.length > 0 &&
    (matchValue == null || trimmed === matchValue) &&
    !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm border-border bg-surface p-5 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-head text-text1">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-body text-text2">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <Input
          id={inputId}
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmRequest = {
  kind: "confirm";
  options: Omit<ConfirmDialogProps, "open" | "onOpenChange" | "onConfirm">;
  resolve: (ok: boolean) => void;
};

type PromptRequest = {
  kind: "prompt";
  options: Omit<TextInputDialogProps, "open" | "onOpenChange" | "onSubmit">;
  resolve: (value: string | null) => void;
};

type DialogRequest = ConfirmRequest | PromptRequest;

let activeRequest: DialogRequest | null = null;
let notifyHost: (() => void) | null = null;

function setRequest(next: DialogRequest | null) {
  activeRequest = next;
  notifyHost?.();
}

/** Promise-based confirm — mount `<DialogHost />` once near the app root. */
export function confirm(options: ConfirmRequest["options"]): Promise<boolean> {
  return new Promise((resolve) => {
    setRequest({ kind: "confirm", options, resolve });
  });
}

/** Promise-based text prompt — mount `<DialogHost />` once near the app root. */
export function promptText(
  options: PromptRequest["options"],
): Promise<string | null> {
  return new Promise((resolve) => {
    setRequest({ kind: "prompt", options, resolve });
  });
}

export function DialogHost() {
  const [request, setLocal] = useState<DialogRequest | null>(activeRequest);

  useEffect(() => {
    const sync = () => setLocal(activeRequest);
    notifyHost = sync;
    sync();
    return () => {
      if (notifyHost === sync) notifyHost = null;
    };
  }, []);

  if (!request) return null;

  if (request.kind === "confirm") {
    const { options, resolve } = request;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      setRequest(null);
    };
    return (
      <ConfirmDialog
        open
        {...options}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
        onConfirm={() => finish(true)}
      />
    );
  }

  const { options, resolve } = request;
  let settled = false;
  const finish = (value: string | null) => {
    if (settled) return;
    settled = true;
    resolve(value);
    setRequest(null);
  };
  return (
    <TextInputDialog
      open
      {...options}
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
      onSubmit={(value) => finish(value)}
    />
  );
}

/** Shared focus ring for raw `<button>` elements that aren't using `Button`. */
export const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-info-border";
