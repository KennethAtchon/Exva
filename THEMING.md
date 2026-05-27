# Theming

## Tokens

Edit `src/styles.css` to re-theme the app.

| Token                    | Meaning                                    |
| ------------------------ | ------------------------------------------ |
| `--color-success`        | Buy side, positive PnL, healthy status     |
| `--color-success-dim`    | Tinted success background                  |
| `--color-success-border` | Success outline                            |
| `--color-error`          | Sell side, negative PnL, error status      |
| `--color-error-dim`      | Tinted error background                    |
| `--color-error-border`   | Error outline                              |
| `--color-warning`        | Caution, paused, retry/warn states         |
| `--color-warning-dim`    | Tinted warning background                  |
| `--color-warning-border` | Warning outline                            |
| `--color-info`           | Neutral info, review, informational states |
| `--color-info-dim`       | Tinted info background                     |
| `--color-info-border`    | Info outline                               |
| `--color-market`         | Market-context and synthesis states        |
| `--color-market-dim`     | Tinted market background                   |
| `--color-market-border`  | Market outline                             |
| `--color-orange`         | Executing, draining, partial-fill states   |
| `--color-orange-dim`     | Tinted orange background                   |
| `--color-orange-border`  | Orange outline                             |
| `--color-log-debug`      | Debug log text                             |
| `--color-log-info`       | Info log text                              |
| `--color-log-warn`       | Warn log text                              |
| `--color-log-error`      | Error log text                             |

## Inline Style Rule

> **If the value requires a JavaScript expression to compute, it may be inline. If it is a static string, it must be a Tailwind class.**

```tsx
// WRONG - static strings belong in className
style={{ height: "100%", width: "100%", transformOrigin: "left center", transition: "transform 0.5s ease" }}

// RIGHT - split it
<div
  className="h-full w-full origin-left transition-transform duration-500 ease-in-out"
  style={{
    background: color,
    borderRadius: h,
    transform: `scaleX(${Math.min(v / max, 1)})`,
  }}
/>
```

## Light Mode

Toggle light mode on `<html>`:

```ts
document.documentElement.classList.toggle("light");
```

Dark is the default in `:root`. `.light` overrides the token set.

## Tailwind Classes

| Intent             | Class                         |
| ------------------ | ----------------------------- |
| Success text       | `text-success`                |
| Success background | `bg-success-dim`              |
| Success border     | `border-success-border`       |
| Error text         | `text-error`                  |
| Error background   | `bg-error-dim`                |
| Error border       | `border-error-border`         |
| Warning text       | `text-warning`                |
| Warning background | `bg-warning-dim`              |
| Warning border     | `border-warning-border`       |
| Info text          | `text-info`                   |
| Info background    | `bg-info-dim`                 |
| Info border        | `border-info-border`          |
| Market text        | `text-market`                 |
| Market background  | `bg-market-dim`               |
| Market border      | `border-market-border`        |
| Orange text        | `text-status-orange`          |
| Orange background  | `bg-status-orange-dim`        |
| Orange border      | `border-status-orange-border` |
| Log debug          | `text-log-debug`              |
| Log info           | `text-log-info`               |
| Log warn           | `text-log-warn`               |
| Log error          | `text-log-error`              |

## Inline Style → Tailwind Migration

Static presentation belongs in `className`, not `style={{}}` or style object constants. The ESLint rule `theming/no-static-inline-styles` enforces this (warn during migration, error once burn-down completes).

### Classification

| Pattern                                    | Action                                                                |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Fully static object constant               | Replace with `className` or `const someClass = "..."`                 |
| Static JSX inline wrapper                  | Replace with direct `className`                                       |
| Mixed static + dynamic (1–3 dynamic props) | `className` for static; keep computed values in `style`               |
| Fully dynamic object                       | Leave inline                                                          |
| Value on Tailwind scale                    | Stock utility (`gap-2`, `rounded-lg`, …)                              |
| Value off scale                            | Arbitrary utility (`px-[7px]`, `text-[12px]`, `bg-[var(--surface3)]`) |

### Preferred output

1. Single-use wrapper → inline `className` on the element
2. Reused bundle → `const fooClass = "..."` near the component
3. Variants → `cn(baseClass, condition && activeClass)` from `@/lib/utils`
4. Do **not** add custom CSS selectors for one-off static bundles

### Example

```tsx
// BEFORE
const lessonChipStyle = {
  padding: "2px 7px",
  borderRadius: 4,
  background: "var(--surface3)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;

// AFTER
const lessonChipClass =
  "rounded-[4px] bg-[var(--surface3)] px-[7px] py-[2px] font-mono text-[12px]";

// Mixed static + dynamic
<div className="flex gap-2" style={{ color: stateColor, width: `${pct}%` }} />;
```

### Common property mapping

| CSS property                        | Tailwind                                          |
| ----------------------------------- | ------------------------------------------------- |
| `display: "flex"`                   | `flex`                                            |
| `flexDirection: "column"`           | `flex-col`                                        |
| `alignItems: "center"`              | `items-center`                                    |
| `justifyContent: "space-between"`   | `justify-between`                                 |
| `gap: 8`                            | `gap-2`                                           |
| `width: "100%"`                     | `w-full`                                          |
| `fontSize: 12`                      | `text-[12px]`                                     |
| `fontFamily: "var(--font-mono)"`    | `font-mono`                                       |
| `color: "var(--text3)"`             | `text-[var(--text3)]`                             |
| `background: "var(--surface2)"`     | `bg-[var(--surface2)]`                            |
| `border: "1px solid var(--border)"` | `border border-[var(--border)]`                   |
| `borderRadius: 8`                   | `rounded-lg`                                      |
| `padding: "10px 12px"`              | `px-3 py-2.5` or `px-[12px] py-[10px]` when exact |

Preserve exact pixel values with bracket syntax when they do not match the default scale.

## Adding New Colors

1. Add the semantic token to `src/styles.css` first.
2. Extend `tailwind.config.js` with the matching Tailwind color key.
3. Use the token via Tailwind classes or `var(--color-*)` for dynamic inline values.
