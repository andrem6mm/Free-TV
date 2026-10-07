---
name: handoff-protocol
description: How a Free TV worker agent reads its brief, stays in scope, and reports back to the orchestrator. Preloaded by every worker.
---

# Handoff protocol

You were started by the orchestrator with a brief (GOAL / SCOPE / CONTEXT / DONE WHEN / OUT OF SCOPE). It is all you know about the conversation.

## While working

- Stay inside SCOPE. If the goal can't be reached without leaving it, stop and report `blocked` instead of widening the change.
- Read narrowly. Use `grep -n` or a line range, not a whole file, unless the file is small.
- If the brief is ambiguous, pick the most conservative reading, do it, and list the assumption in your report. Ask (`blocked`) only if a wrong guess would be costly to undo.
- Don't commit, push, or spawn agents. The orchestrator owns git and routing.
- Verify your own work before reporting: at minimum `node --check` on JS you touched, plus whatever DONE WHEN asks for.

## Reporting (your final message; the orchestrator sees only this)

Keep it under 15 lines and use exactly this shape:

```
STATUS: done | blocked | failed
CHANGED: path:lines — what (one line per file; "none" if read-only)
VERIFIED: how you checked, with result (command → pass/fail)
NOTES: assumptions, risks, follow-ups (≤3 bullets; omit if none)
DETAIL: .orchestration/reports/<short-task-name>.md (only if you wrote one)
```

Put anything longer (logs, full findings, screenshots list) in `.orchestration/reports/<short-task-name>.md` and point to it.
Never paste raw logs, whole diffs, or file contents into the report.
