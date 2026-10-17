#!/usr/bin/env bash
# Record a Maestro demo flow to raw video via simctl (not committed).
#
# Usage:
#   ./scripts/record-demo-maestro.sh sign-in-jordan   # once, then leave session
#   ./scripts/record-demo-maestro.sh log-a-round
#   ./scripts/record-demo-maestro.sh create-tournament
#
# Env:
#   SIM_UDID   optional
#   OUT_DIR    default: ~/Desktop/SimCap-demo-recordings

set -euo pipefail

# Always clear a stuck simctl host recorder before anything else.
pkill -f "simctl io.*recordVideo" 2>/dev/null || true
sleep 1

FLOW_NAME="${1:-}"
if [[ -z "$FLOW_NAME" ]]; then
  echo "Usage: $0 <sign-in-jordan|log-a-round|create-tournament>"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW="$ROOT/maestro/${FLOW_NAME}.yaml"
if [[ ! -f "$FLOW" ]]; then
  echo "Missing flow: $FLOW"
  exit 1
fi

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

OUT_DIR="${OUT_DIR:-$HOME/Desktop/SimCap-demo-recordings}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_MOV="$OUT_DIR/${FLOW_NAME}-${STAMP}.mov"

SIM_UDID="${SIM_UDID:-}"
if [[ -z "$SIM_UDID" ]]; then
  SIM_UDID="$(xcrun simctl list devices booted | awk -F '[()]' '/Booted/{print $2; exit}')"
fi
if [[ -z "$SIM_UDID" ]]; then
  echo "No booted simulator."
  exit 1
fi

if ! xcrun simctl get_app_container "$SIM_UDID" com.simcap.app >/dev/null 2>&1; then
  echo "com.simcap.app not installed. Install the Release sim build first."
  exit 1
fi

echo "Simulator: $SIM_UDID"
echo "Flow:      $FLOW"
echo "Output:    $OUT_MOV"

# Second clear immediately before start (belt-and-suspenders with top-of-script pkill)
pkill -f "simctl io.*recordVideo" 2>/dev/null || true
sleep 1

REC_PID=""
start_recorder() {
  xcrun simctl io "$SIM_UDID" recordVideo --codec=h264 "$OUT_MOV" &
  REC_PID=$!
  sleep 2
  kill -0 "$REC_PID" 2>/dev/null
}

if ! start_recorder; then
  echo "Recorder busy — rebooting simulator and retrying once…"
  pkill -f "simctl io.*recordVideo" 2>/dev/null || true
  xcrun simctl shutdown "$SIM_UDID" 2>/dev/null || true
  sleep 2
  xcrun simctl boot "$SIM_UDID"
  open -a Simulator
  sleep 4
  pkill -f "simctl io.*recordVideo" 2>/dev/null || true
  sleep 1
  if ! start_recorder; then
    echo "Video recorder still failed — running Maestro without recording."
    REC_PID=""
    OUT_MOV=""
  fi
fi

cleanup() {
  if [[ -n "${REC_PID}" ]] && kill -0 "$REC_PID" 2>/dev/null; then
    kill -INT "$REC_PID" 2>/dev/null || true
    wait "$REC_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -n "${REC_PID}" ]]; then
  echo "Recording… starting Maestro"
else
  echo "Starting Maestro (no video)…"
fi
set +e
maestro --device "$SIM_UDID" test "$FLOW"
MAESTRO_EC=$?
set -e
echo "Maestro exit: $MAESTRO_EC — finalizing…"
sleep 1
cleanup
trap - EXIT

if [[ -n "${OUT_MOV}" && -f "$OUT_MOV" ]]; then
  ls -lh "$OUT_MOV"
  echo "Done: $OUT_MOV"
elif [[ -n "${OUT_MOV}" ]]; then
  echo "Recording file missing: $OUT_MOV"
  exit 1
fi
exit "$MAESTRO_EC"
