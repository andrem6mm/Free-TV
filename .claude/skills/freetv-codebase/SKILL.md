---
name: freetv-codebase
description: Compact map of the Free TV codebase (files, app.js sections, conventions, cache-busting rule). Load before reading or changing any Free TV source file.
---

# Free TV codebase map

Free TV is a static PWA with no build step, no framework, and no npm dependencies. It plays the iptv-org M3U playlist.
Run it locally with `python3 -m http.server 8000`. It deploys to GitHub Pages from the default branch (`.github/workflows/pages.yml`).

| File | What it is |
| --- | --- |
| `index.html` | All markup. Elements are looked up by `id` from app.js. |
| `app.js` | All logic, one IIFE in `'use strict'`. About 850 lines, split into `// ---------- name ----------` sections. |
| `styles.css` | Dark theme. Tokens on `:root` (`--bg --surface --surface-2 --border --text --muted --accent --star --danger --radius`). Mobile breakpoint is `max-width: 860px`. |
| `sw.js` | Service worker: app-shell cache, stale-while-revalidate for `.m3u`, network-first for app files. |
| `manifest.webmanifest`, `icons/` | PWA install metadata. |
| `vendor/hls.min.js` | hls.js (Apache-2.0). Never edit it. |

**app.js sections** (find a line with `grep -n "// ---------- " app.js`): storage (`store.get/set`, `freetv:` localStorage prefix), elements (`$()`), state, helpers, playlist parsing (`parseM3U`, `makeChannel`), loading (fetch, mirror fallback, timeout), filtering & rendering (paged at `PAGE_SIZE`), back to top, playback (hls.js and native HLS, load timeout, recovery), controls (keys, swipe), country picker, collapse list, share, install/offline (SW registration).

## Conventions

- Vanilla ES2020+. No dependencies, no modules, no build. Match the existing terse style and comment density.
- Persist through `store.get/set` only, never raw `localStorage`. Persisted prefs live in the `prefs` object.
- User-facing copy is plain and short. Update `README.md` features or shortcuts when behavior changes.
- **Cache-bust rule (required whenever `app.js` or `styles.css` changes):** bump `?v=N` in `index.html` (2 places) and in the `SHELL` list of `sw.js` (2 places), and bump `VERSION = 'freetv-vN'` in `sw.js`. Use the same N everywhere. If any of these is missed, installed users keep stale code.
- Plain `http://` streams are blocked on https pages, so the app hides them by default. Don't "fix" this by proxying.
