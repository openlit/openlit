#!/usr/bin/env bash
# OpenLit Cursor hook entry point.
#
# Cursor invokes this script per hook event with --event=<name>; we forward
# stdin and the event name to `openlit coding hook --vendor=cursor`. The
# wrapper exists so we can probe PATH for `openlit` ourselves and log a
# friendly hint to stderr when the binary is missing — Cursor surfaces
# stderr in its hook diagnostics view.
#
# We always exit 0 so a missing or broken openlit binary never blocks the
# user's prompt.

set -u

EVENT=""
for arg in "$@"; do
  case "$arg" in
    --event=*) EVENT="${arg#--event=}" ;;
  esac
done

if ! command -v openlit >/dev/null 2>&1; then
  echo "openlit: 'openlit' binary not on PATH; install with 'curl -sSL https://openlit.io/install.sh | sh' or 'brew install openlit/tap/openlit'." >&2
  exit 0
fi

# Cursor sends JSON on stdin; forward it untouched.
exec openlit coding hook --vendor=cursor --event="${EVENT}"
