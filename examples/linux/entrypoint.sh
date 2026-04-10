#!/usr/bin/env bash
set -eu

echo "=== OpenLIT Linux Host Simulation ==="
echo "Starting sample Python apps as background processes..."

python -u /apps/openai_app.py &
python -u /apps/gemini_app.py &
python -u /apps/bedrock_app.py &

sleep 3
echo "Sample apps running. Starting OpenLIT Controller in Linux mode..."
exec openlit-controller
