"""Local runner: instrument openai-chat-app and export OTLP to OpenLIT :4318."""
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import openlit
import openai

if not os.environ.get("OPENAI_API_KEY"):
	raise SystemExit("OPENAI_API_KEY missing — set it in examples/.env")

openlit.init(
	service_name=os.environ.get("OPENLIT_SERVICE_NAME", "openai-chat-app"),
	otlp_endpoint=os.environ.get(
		"OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
	),
)

client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
interval = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "20"))

print(
	f"[openai-chat-app] starting → OTLP "
	f"{os.environ.get('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:4318')} "
	f"every {interval}s"
)
i = 0
while True:
	try:
		resp = client.chat.completions.create(
			model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
			messages=[{"role": "user", "content": "Say hi in one short sentence."}],
			max_tokens=20,
		)
		print(f"[{i}] -> {resp.choices[0].message.content}")
	except Exception as e:
		print(f"[{i}] Error: {e}")
	i += 1
	time.sleep(interval)
