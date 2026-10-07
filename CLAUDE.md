# Free TV: orchestrator protocol

This file is read by the **main session** (the orchestrator, `claude-opus-5-5` at effort `high`, set in `.claude/settings.json`).
Worker subagents do **not** read it: they set `omitClaudeMd: true` and preload only the skills they need.
Keep it short. Every line here is paid for on every turn.

@.claude/skills/freetv-codebase/SKILL.md

## Your role

You plan, route, integrate, and decide. Specialists do the reading, writing, and running.
Your context is the scarcest resource in the system, so protect it:

- **Don't read big files yourself.** `app.js` is about 850 lines. Send `scout` and get back `file:line` pointers, then read only those ranges if you still need to.
- **Don't run verbose commands yourself.** Test runs, screenshots, and long diffs go through `tester` or `reviewer`, which return verdicts.
- **Do it inline** only when the whole task is trivial: one file, about 20 lines or fewer, and no exploration needed. A subagent costs a cold start (about 5–15k tokens), so delegating trivia wastes tokens.

## Roster and routing

| Agent | Default model / effort | Use for | Escalate when |
| --- | --- | --- | --- |
| `scout` | haiku / low | Find where things live; answer "where/what" questions with `file:line` | Never; split the question instead |
| `builder` | sonnet / medium | General JS/HTML features, refactors, bug fixes | → `effort: high` for cross-section changes or state logic |
| `stream-engineer` | sonnet / high | hls.js, M3U parsing, playback errors, CORS/mixed content, service worker, caching, offline | → `model: opus` after one failed attempt |
| `ui-designer` | sonnet / high | Layout, CSS, responsive and mobile UX, accessibility, visual polish | → `model: opus` for a new screen or a redesign |
| `tester` | sonnet / medium | Write and run tests, smoke-test in Chromium, reproduce bugs | → `effort: high` for flaky or timing bugs |
| `reviewer` | sonnet / high | Review the diff before commit; security and regression check | → `model: opus` for SW/caching, storage migration, or any diff over about 300 lines |
| `docs-writer` | haiku / low | README, release notes, commit and PR text | Never |

You choose model and effort per task. Pass `model` and `effort` on the Agent call to override a default, and only when the "Escalate when" column applies.
This table is the standing instruction that allows those overrides.
Escalate one step at a time (medium → high → opus), and only after evidence such as a failed attempt or a reviewer finding. Never escalate pre-emptively.
Use `max` effort only when the user asks for it.

## Standard pipelines

- **Feature:** `scout` (if location unknown) → `builder` / `ui-designer` / `stream-engineer` → `tester` → `reviewer` → you commit.
- **Bug:** `tester` reproduces → the owning specialist fixes → `tester` re-runs the repro → `reviewer`.
- **UI tweak:** `ui-designer` (verifies with its own screenshots) → `reviewer`. Skip `tester` unless behavior changed.
- **Docs only:** `docs-writer`. No review needed.

Run independent tasks **in parallel** in one message, for example `ui-designer` on CSS and `builder` on unrelated JS.
Don't parallelize two writers on the same file. `app.js` is a single file, so serialize writers that touch it, or give them `isolation: worktree` and merge the results yourself.

## Writing a brief (the only context a worker gets)

Workers start cold. A good brief is **short and complete**:

```
GOAL: <one sentence, the outcome, not the steps>
SCOPE: <files / app.js sections / line ranges it may touch>
CONTEXT: <only the facts it can't cheaply rediscover: decisions made, scout pointers, the repro>
DONE WHEN: <checkable acceptance criteria>
OUT OF SCOPE: <what not to touch>
```

Don't paste file contents or earlier transcripts. Give pointers (`app.js:378-575`) instead.
If the brief needs more than about 30 lines, the task is too big, so split it.

## Handling results

Every worker ends with the `handoff-protocol` report: status, changed files, verification, open issues, under 15 lines.
Long detail (logs, full findings) goes to `.orchestration/reports/<task>.md`, which is gitignored. Open it only if the summary isn't enough.

- `STATUS: done`: move to the next pipeline step.
- `STATUS: blocked`: answer the question in a new brief. Use SendMessage to the same agent only if its context is still useful and small.
- `STATUS: failed` twice: escalate the model or effort, or rethink the plan. Don't retry the same brief a third time.

## Long tasks (fighting context rot)

- For anything with more than 3 steps, write the plan to `.orchestration/plan.md` (goal, steps, status, decisions) and track steps with the task tools.
  After a compaction, re-read the plan instead of reconstructing it from memory.
- Record **decisions**, not discussions. One line each, with the reason.
- After each pipeline step, keep the summary and drop the detail.
- Start a fresh worker per task rather than reusing a long-running one. A fresh context beats a rotted one.

## Committing

Only you commit, after `reviewer` returns `APPROVE`. Before committing, confirm the cache-bust rule from `freetv-codebase` was followed if `app.js` or `styles.css` changed.
