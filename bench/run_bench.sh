#!/usr/bin/env bash
set -e
MODE="wasm"
DURATION=30
for arg in "$@"; do
  case $arg in
    --mode=*) MODE="${arg#*=}"; shift;;
    --duration=*) DURATION="${arg#*=}"; shift;;
  esac
done
curl -s "http://localhost:3000/bench/start?mode=${MODE}&duration=${DURATION}" >/dev/null || true
echo "Open http://localhost:3000/?auto=1&mode=${MODE} on the viewer and keep the phone streaming."
echo "Waiting $DURATION seconds for metrics..."
sleep $((DURATION+5))
echo "Metrics:"
curl -s http://localhost:3000/metrics.json || echo "{}"
