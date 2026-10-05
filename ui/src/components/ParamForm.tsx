// Strategy settings form generated from the strategy's JSON schema (built from its zod params).
import { Field, NumberInput, Switch, TextArea } from "./ui.tsx";

interface Prop {
  type?: string;
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  maxLength?: number;
}

export function ParamForm({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const entries = Object.entries(props);
  if (!entries.length)
    return <div className="text-sm text-ink3">This strategy has no settings.</div>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(([key, p]) => {
        const label = p.title ?? key;
        const current = value[key] ?? p.default;
        if (p.type === "boolean") {
          return (
            <Switch
              key={key}
              checked={Boolean(current)}
              onChange={(v) => set(key, v)}
              label={label}
            />
          );
        }
        if (p.type === "string") {
          return (
            <div key={key} className="sm:col-span-2">
              <Field label={label} hint={p.description}>
                <TextArea
                  rows={3}
                  value={String(current ?? "")}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            </div>
          );
        }
        const integer = p.type === "integer";
        return (
          <Field key={key} label={label} hint={p.description}>
            <NumberInput
              value={typeof current === "number" ? current : null}
              min={p.minimum}
              max={p.maximum}
              step={integer ? 1 : "any"}
              onChange={(v) => set(key, v === null ? undefined : integer ? Math.round(v) : v)}
            />
          </Field>
        );
      })}
    </div>
  );
}
