#!/usr/bin/env bash
# PostToolUse hook: syntax-check any .js file right after an Edit/Write.
# Catches broken JS for zero LLM tokens; on failure the error is fed back to the agent (exit 2).
command -v node >/dev/null 2>&1 || exit 0
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input.file_path||"")}catch{}})')
case "$file" in
  *.js|*.mjs) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
if ! out=$(node --check "$file" 2>&1); then
  echo "Syntax error in $file:" >&2
  echo "$out" | head -20 >&2
  exit 2
fi
exit 0
