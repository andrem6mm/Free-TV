# Free TV agent team

Claude Code in this repo runs as an **orchestrator** (`claude-opus-5-5`, effort `high`) that routes work to specialist subagents.
You just describe the task; the orchestrator plans it, picks the agent, model, and effort, checks the results, and commits.

| Agent | Model / effort | Job |
| --- | --- | --- |
| scout | Haiku 4.5 / low | Find code and return `file:line` pointers (read-only) |
| builder | Sonnet 5.5 / medium | Features, bug fixes, refactors |
| stream-engineer | Sonnet 5.5 / high | hls.js, playlist, CORS, service worker |
| ui-designer | Sonnet 5.5 / high | CSS, layout, mobile UX, accessibility, screenshots |
| tester | Sonnet 5.5 / medium | Repro bugs, smoke tests, Playwright specs |
| reviewer | Sonnet 5.5 / high | Pre-commit review gate, keeps project memory |
| docs-writer | Haiku 4.5 / low | README, commit and PR text |

The orchestrator escalates a worker to higher effort or to Opus only after evidence that it's needed (rules in `CLAUDE.md`).

## How it keeps context small

- **Hub and spoke, one level deep** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`). Workers can't spawn more agents.
- **Workers skip `CLAUDE.md`** (`omitClaudeMd: true`) and preload only the skills they need, so each starts with a small, relevant context.
- **Briefs, not transcripts.** Workers get a 5-field brief with `file:line` pointers, never pasted files.
- **Reports, not logs.** Workers return a report of under 15 lines; anything long goes to `.orchestration/reports/` (gitignored).
- **Zero-token checks.** A hook runs `node --check` on every JS edit, and `.claude/tools/smoke.mjs` does the Playwright work in one command.
- **Plans on disk.** Long tasks keep `.orchestration/plan.md`, so a compacted orchestrator re-reads it instead of guessing.

## Layout

```
CLAUDE.md                 orchestrator protocol and routing table (main session only)
.claude/settings.json     orchestrator model and effort, spawn depth, JS syntax hook
.claude/agents/*.md       the 7 workers
.claude/skills/*/SKILL.md shared knowledge preloaded into workers
.claude/tools/smoke.mjs   headless smoke test and screenshots (fixture playlist)
tests/fixtures/           sample.m3u used by tests
```

Overrides: put `{"model": "...", "effortLevel": "xhigh"}` in `.claude/settings.local.json` (gitignored), or use `/effort` during a session.
