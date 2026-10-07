---
name: review-checklist
description: Free TV pre-commit review checklist and verdict format. Load when reviewing a diff.
---

# Review checklist

Review `git diff` (plus `git diff --cached`) against the brief's GOAL. Read surrounding code only where a hunk's correctness depends on it.

**Blocking (must fix):**
- The brief's DONE WHEN isn't met, or the diff changes things outside SCOPE.
- Cache-bust rule broken: `app.js` or `styles.css` changed but `?v=N` in `index.html` and `sw.js` and `VERSION` aren't all bumped to the same N.
- Runtime errors: undefined identifiers, a missing element `id` in `index.html`, unguarded `null` from `$()`, async rejections nobody catches.
- XSS: playlist data (names, logos, groups, URLs) is untrusted. It must go through `textContent` or properties, never `innerHTML` or string-built HTML. URLs into `src` or `href` must be `http(s):` only.
- Leaks: a new hls instance without destroying the old one, timers not cleared, listeners added on each render.
- Performance: any O(n²) or per-channel DOM or network work over the full list (about 10k entries).
- Storage: raw `localStorage` instead of `store`, or a renamed key without migration, which loses users' favorites.
- Accessibility regressions: an icon button without a label, keyboard shortcuts broken, focus lost.

**Non-blocking:** style mismatches with surrounding code, naming, comment density, a README not updated.

## Verdict (in the handoff report)

```
STATUS: done
VERDICT: APPROVE | CHANGES_REQUESTED
BLOCKING: path:line — problem → fix (one line each; omit if none)
NITS: ≤3 one-liners (omit if none)
```

Check only what the diff touches; don't re-review unchanged code.
Re-reviews only check the previous BLOCKING items and the new hunks.
