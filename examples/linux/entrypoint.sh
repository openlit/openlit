#!/usr/bin/env bash
set -eu

echo "=== OpenLIT Linux Host Simulation ==="
echo "Starting sample Python apps as background processes..."

env -u OTEL_EXPORTER_OTLP_ENDPOINT \
    -u OPENLIT_URL \
    -u OPENLIT_POLL_INTERVAL \
    -u OPENLIT_PROC_ROOT \
    python -u /apps/openai_app.py &

env -u OTEL_EXPORTER_OTLP_ENDPOINT \
    -u OPENLIT_URL \
    -u OPENLIT_POLL_INTERVAL \
    -u OPENLIT_PROC_ROOT \
    python -u /apps/gemini_app.py &

env -u OTEL_EXPORTER_OTLP_ENDPOINT \
    -u OPENLIT_URL \
    -u OPENLIT_POLL_INTERVAL \
    -u OPENLIT_PROC_ROOT \
    python -u /apps/bedrock_app.py &

sleep 3
echo "Sample apps running. Starting OpenLIT Controller in Linux mode..."
exec openlit-controller
