---
name: ui-design-system
description: Free TV visual language and UI rules (tokens, layout, touch, accessibility) plus how to verify UI changes with screenshots. Load for any CSS, layout, or markup change.
---

# Free TV UI design system

## Visual language

- Dark only. Use the `:root` tokens in `styles.css` and never hard-code a color that a token covers. Add a new token only if one is really missing.
  The surface ladder is `--bg` → `--surface` → `--surface-2`, lines are `--border`, text is `--text` or `--muted`, actions are `--accent`, favorites are `--star`, and errors are `--danger`.
- Corners use `--radius` (10px). Pills and chips are fully rounded. Buttons reuse the `.btn` modifiers (`primary`, `ghost`, `icon`) rather than new button classes.
- Typography is the system font stack and stays compact. Channel rows are dense and scannable: number, logo or initials, name, meta line, star.

## Layout and responsiveness

- There is one breakpoint: `max-width: 860px` stacks the player above the list; `min-width: 861px` puts them side by side. Reuse it and don't introduce new breakpoints.
- Design mobile-first at 390px wide, then check 1280px. There must be no horizontal scroll at 360px.
- Respect safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`). The app runs standalone as an installed PWA on notched phones.

## Interaction and accessibility

- Touch targets are at least 40×40px. Hover styles must not be the only affordance.
- Every icon-only button has `aria-label` and `title`. Toggles update `aria-expanded` or `aria-pressed`. Dialogs use `aria-haspopup="dialog"` and get focus management.
- Focus must be visible (`:focus-visible`). Motion goes behind `prefers-reduced-motion`.
- Text contrast is at least 4.5:1 on its surface. `--muted` on `--surface-2` is the weakest pair, so check it if you use it for small text.
- Keyboard shortcuts (↑/↓, digits, F, M, /) must keep working. Don't steal those keys inside new widgets unless the widget has focus.

## Verify every UI change (required)

```
node .claude/tools/smoke.mjs                       # 390px + 1280px shots, fixture playlist
node .claude/tools/smoke.mjs --click '#countryBtn' # open a widget first
```

Then **look at** `.orchestration/shots/390.png` and `1280.png` with Read. Check alignment, overflow, contrast, and that nothing else regressed.
Report what you checked in one line. Don't describe the screenshot at length.
CSS changes trigger the cache-bust rule in `freetv-codebase`.
