---
name: testing-playbook
description: How to test Free TV (smoke tool, fixture playlist, Playwright specs, bug repro, what to report). Load for writing or running tests or reproducing bugs.
---

# Free TV testing playbook

Free TV has no build and no npm dependencies. Testing has three layers; pick the cheapest one that proves the point.

1. **Syntax:** `node --check app.js sw.js`. Free, so always run it.
2. **Smoke:** `node .claude/tools/smoke.mjs [--click sel] [--eval "expr"]`. This serves the repo, loads it in headless Chromium against `tests/fixtures/sample.m3u` (6 channels: News/us, Sports/uk, Kids/de, Movies/fr with a geo-blocked tag, an http-only one/ee, one with no id/es), blocks service workers and real streams, and reports `count`, list items, page errors, and screenshots. Exit 1 means page errors.
3. **Specs:** for behavior worth guarding permanently, add `tests/<feature>.spec.mjs` as a plain Node script using `playwright` (installed globally, resolve it like `smoke.mjs` does). Reuse the same serve-and-route-fixture pattern. Run it with `node tests/<file>`.
   Keep each spec under about 80 lines, assert with `node:assert`, and print one line per check.

## Rules

- `parseM3U` and friends live inside the app.js IIFE and aren't importable. Test them through the UI with the fixture (counts, chips, meta lines). Don't refactor app.js just to test it unless the brief says so.
- Extend the fixture rather than hitting the live playlist. Use `--live` only when the bug is about real-world data, and say so in the report.
- Actual video playback can't be verified headless with fake URLs. Test the app's *reaction* instead: the overlay text, the Retry and Next buttons, and the load timeout.
- **Bug repro first:** write the smallest failing check, confirm it fails, and hand it to the orchestrator. After a fix, re-run that exact check.
- `localStorage` state is per context, and each smoke run starts clean. To test persistence, reload inside the same context in a spec.

## Report

`VERIFIED:` gives each command and its pass/fail. On failure include only the assertion or error line and the step that failed, not the whole log.
Write longer logs to `.orchestration/reports/`.
