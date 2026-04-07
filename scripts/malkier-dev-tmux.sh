#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="malkier-dev"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed or not on PATH." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists; attaching."
  echo "To start fresh: tmux kill-session -t $SESSION"
  exec tmux attach -t "$SESSION"
fi

tmux new-session -d -s "$SESSION" -c "$ROOT/apps/api" "bun run dev"
tmux split-window -v -t "$SESSION" -c "$ROOT/apps/solid" "bun run dev"
tmux select-layout -t "$SESSION" even-vertical
exec tmux attach -t "$SESSION"
