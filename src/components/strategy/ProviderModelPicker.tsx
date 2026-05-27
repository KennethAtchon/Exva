import { useId, useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ProviderAccount } from "@/lib/types";
import type { ProviderModelEntry } from "@/lib/exva";

const ModelCombobox = ({
  value,
  onChange,
  options,
  disabled,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ProviderModelEntry[];
  disabled?: boolean;
  loading?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled || loading}
          className="h-10 w-full justify-between border-border bg-[var(--surface2)] px-3 text-[13px] font-normal text-[var(--text1)] hover:bg-[var(--surface2)] hover:text-[var(--text1)]"
        >
          <span className={cn("truncate", !value && "text-[var(--text3)]")}>
            {loading
              ? "Loading models…"
              : selected
                ? selected.label
                : value || "Select a model"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList id={listId}>
            <CommandEmpty className="p-3 text-[12px] text-[var(--text3)]">
              No models found.
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.label} ${o.id}`}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      o.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]">{o.label}</div>
                    {o.label !== o.id && (
                      <div className="truncate font-mono text-[12px] text-[var(--text3)]">
                        {o.id}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const ProviderModelPicker = ({
  providers,
  providerKey,
  modelId,
  models,
  modelsLoading = false,
  disabled = false,
  onProviderChange,
  onModelChange,
}: {
  providers: ProviderAccount[];
  providerKey: string;
  modelId: string;
  models: ProviderModelEntry[];
  modelsLoading?: boolean;
  disabled?: boolean;
  onProviderChange: (providerKey: string) => void;
  onModelChange: (modelId: string) => void;
}) => (
  <div className="grid gap-2.5">
    <div className={fieldClass}>
      <div className={fieldLabelClass}>Provider</div>
      <ShadcnSelect
        value={providerKey}
        onValueChange={onProviderChange}
        disabled={disabled}
        options={[
          { value: "", label: "No provider" },
          ...providers.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
    <div className={fieldClass}>
      <div className={fieldLabelClass}>Model</div>
      <ModelCombobox
        value={modelId}
        onChange={onModelChange}
        options={models}
        disabled={disabled || !providerKey}
        loading={modelsLoading}
      />
    </div>
  </div>
);

const fieldClass = "grid gap-1";
const fieldLabelClass = "text-[12px] text-[var(--text3)]";
