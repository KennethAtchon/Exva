# Exva shadcn UI Usage Guide (Phase 0)

## Purpose

Use shadcn primitives as default for new renderer UI work. Keep Exva look by using semantic tokens in `src/styles.css` and utility classes over inline style.

## Source of truth

- Base primitives: `src/components/ui/*`
- Class merge helper: `src/lib/utils.ts` (`cn`)
- Theme tokens: `src/styles.css`

## Rules for new UI code

1. Use `src/components/ui/*` first before custom atoms.
2. Prefer class composition (`className`) over inline style.
3. Use semantic utilities (`bg-card`, `text-muted-foreground`, `border-border`) over hardcoded colors.
4. If variant missing, extend component locally in `src/components/ui/*`.
5. Do not add new exports to legacy `src/components/atoms.tsx`.

## Phase 0 baseline components

- Button
- Input
- Card
- Dialog
- DropdownMenu
- Table
- Badge
- Tabs
- Select
- Tooltip
- Separator

## Migration guidance

- Convert one primitive family at time.
- Keep behavior stable while swapping UI layer.
- If style mismatch appears, adjust semantic token map first, component override second.
