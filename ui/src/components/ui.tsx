// The one component kit. Static styling lives in Tailwind classes; colors come from styles.css.
import type { DecisionKind } from "@shared/types.ts";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
} from "react";
import { KIND_STYLE } from "../format.ts";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/90",
  outline: "border border-line text-ink hover:bg-surface2",
  ghost: "text-ink2 hover:text-ink hover:bg-surface2",
  danger: "bg-down/15 text-down border border-down/40 hover:bg-down/25",
};

export function Button({
  variant = "outline",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-hair px-4 py-2.5">
          <h2 className="font-mono text-label uppercase text-ink2">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 font-mono text-label uppercase text-ink3">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
      {hint && <div className="mt-1 text-xs text-ink3">{hint}</div>}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded border border-line bg-surface2 px-2.5 text-sm text-ink placeholder:text-ink3 focus:border-ink2 focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function NumberInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      {...rest}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={cx(inputClass, "font-mono", rest.className)}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cx(inputClass, "h-auto min-h-20 py-2", props.className)} />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(inputClass, className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left text-sm"
    >
      <span
        className={cx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-up/70" : "bg-surface3",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all",
            checked ? "left-4.5" : "left-0.5",
          )}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex gap-1 border-b border-hair">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
            value === t.value
              ? "border-ink text-ink"
              : "border-transparent text-ink2 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className={cx("truncate font-mono text-xl", tone)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-ink3">{sub}</div>}
    </div>
  );
}

export function KindBadge({ kind }: { kind: DecisionKind }) {
  return (
    <span
      className={cx(
        "inline-block w-12 shrink-0 rounded border px-1 text-center font-mono text-label uppercase",
        KIND_STYLE[kind],
      )}
    >
      {kind}
    </span>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "error" | "off" }) {
  const color = { ok: "bg-up", warn: "bg-warn", error: "bg-down", off: "bg-ink3" }[tone];
  return (
    <span
      className={cx(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        color,
        tone === "ok" && "shadow-[0_0_6px] shadow-up/60",
      )}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-ink3">{children}</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded border px-3 py-2 text-sm",
        tone === "warn"
          ? "border-warn/30 bg-warn/10 text-warn"
          : "border-info/30 bg-info/10 text-info",
      )}
    >
      {children}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={cx(
          "w-full rounded border border-line bg-surface shadow-2xl",
          wide ? "max-w-3xl" : "max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hair px-4 py-3">
          <h2 className="text-base font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink3 hover:text-ink"
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  bot: "M12 3v3m-6 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zm3 5h.01M15 14h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  spark:
    "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  play: "M7 4.5v15l12-7.5z",
  stop: "M6 6h12v12H6z",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
};

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("h-4 w-4 shrink-0", className)}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
