#!/usr/bin/env bash
# Runs the dev app for N seconds, then tears down the whole process tree.
# Usage: scripts/dev-smoke.sh [seconds] [logfile]
set -uo pipefail

SECONDS_TO_RUN="${1:-30}"
LOG="${2:-/tmp/hbb-dev-smoke.log}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
setsid pnpm start >"$LOG" 2>&1 &
LEADER=$!
echo "leader=$LEADER log=$LOG"

sleep "$SECONDS_TO_RUN"

# Kill the session/process group, then any electron trees that escaped it.
kill -TERM -"$LEADER" 2>/dev/null
sleep 2
for pid in $(ps -eo pid,args | grep "node_modules/electron/dist/electron --ozone-platform" | grep -v grep | awk '{print $1}'); do
  kill -TERM "$pid" 2>/dev/null
done
sleep 3
for pid in $(ps -eo pid,args | grep "node_modules/electron/dist/electron" | grep -v grep | awk '{print $1}'); do
  kill -KILL "$pid" 2>/dev/null
done
sleep 1

echo "electron procs: $(pgrep -fc 'node_modules/electron/dist/electron' || echo 0)"
echo "windows: $(xwininfo -root -tree 2>/dev/null | grep -c '"HBBatchBeast"')"
