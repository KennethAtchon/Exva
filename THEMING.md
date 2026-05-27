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

## Adding New Colors

1. Add the semantic token to `src/styles.css` first.
2. Extend `tailwind.config.js` with the matching Tailwind color key.
3. Use the token via Tailwind classes or `var(--color-*)` for dynamic inline values.
