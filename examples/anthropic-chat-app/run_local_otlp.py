"""Local runner: instrument anthropic-chat-app and export OTLP to OpenLIT :4318."""
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import anthropic
import openlit

api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
	raise SystemExit("ANTHROPIC_API_KEY missing — set it in examples/.env")

openlit.init(
	service_name=os.environ.get("OPENLIT_SERVICE_NAME", "anthropic-chat-app"),
	otlp_endpoint=os.environ.get(
		"OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
	),
)

client = anthropic.Anthropic(api_key=api_key)
interval = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "20"))

print(
	f"[anthropic-chat-app] starting → OTLP "
	f"{os.environ.get('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:4318')} "
	f"every {interval}s"
)
i = 0
while True:
	try:
		resp = client.messages.create(
			model=os.environ.get(
				"ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"
			),
			max_tokens=20,
			messages=[{"role": "user", "content": "Say hi in one short sentence."}],
		)
		print(f"[{i}] -> {resp.content[0].text}")
	except Exception as e:
		print(f"[{i}] Error: {e}")
	i += 1
	time.sleep(interval)
