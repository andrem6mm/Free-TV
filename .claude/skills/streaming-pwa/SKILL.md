---
name: streaming-pwa
description: Domain knowledge for Free TV playback and offline behavior (hls.js, native HLS, M3U format, CORS and mixed content, service worker caching). Load for playback, playlist, or service-worker work.
---

# Streaming and PWA playbook

## Playback (`app.js` → `// ---------- playback ----------`)

- Apple devices use native HLS (`video.src = url`), because Safari's player doesn't need CORS headers. Everything else uses hls.js from `vendor/hls.min.js`, and native HLS is the fallback when hls.js isn't supported. Keep both paths working.
- Destroy the previous `hls` instance before starting a new one, and clear `loadTimer`. Leaked instances keep downloading segments.
- Fatal hls.js errors: a `MEDIA_ERROR` gets one `recoverMediaError()` (guarded by `triedRecover`); anything else calls `fail()`, which shows the overlay with Retry, Next, and copy/share/"Open in VLC". Never loop on recovery.
- `LOAD_TIMEOUT_MS` (20s) decides that a dead stream is dead. Many iptv-org streams are offline, so failure is normal and has to be fast and clear.
- Mixed content: `http://` streams can't play on an https page. The app hides them by default (`hideHttp`), and picking one goes straight to the copy/VLC options. CORS-blocked streams fail in hls.js with a network error; there's no fix on our side.
- Autoplay: `tryPlay()` catches a rejected `video.play()` and hides the overlay so the user can press play. Keep that catch on any new play path.

## Playlist (M3U)

- An `#EXTINF:-1 key="value" …,Title` line is followed by a URL line. Attributes used: `tvg-id` (country is derived from `.cc` or `@`), `tvg-country`, `tvg-logo`, and `group-title` (`;`-separated; `Undefined` is dropped).
- Titles carry `[Geo-blocked]`, `[Not 24/7]`-style tags and `(720p)` quality, which are stripped into `tags` and `quality`.
- The full playlist is about 10k entries and several MB. Parsing and rendering must stay linear and paged (`PAGE_SIZE`). No per-item network work at load.

## Service worker (`sw.js`)

- The app shell is precached under `VERSION`. `activate` deletes the old caches. `.m3u` uses stale-while-revalidate; same-origin files are network-first with `cache: 'no-cache'`, falling back to cache.
- Cross-origin requests (streams, logos) pass through untouched. Never cache `.m3u8` or `.ts`.
- Any change to `app.js` or `styles.css` triggers the cache-bust rule in `freetv-codebase`. A change to `sw.js` itself only needs the `VERSION` bump.
- The app registers with `reg.update()` and reloads once on `controllerchange` when an old controller existed, but not while a channel is playing. Don't create reload loops.
- Test SW logic by reasoning plus a targeted spec (`serviceWorkers: 'allow'`). `smoke.mjs` blocks SWs on purpose.
