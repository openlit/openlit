import os
import time

import openai

# Point a standard OpenAI client at the self-hosted LiteLLM proxy (an
# OpenAI-compatible LLM gateway). The controller's eBPF scanner discovers the
# connection to the proxy host:port (configured via custom_llm_hosts), and OBI's
# custom (OpenAI-compatible) extractor parses the payload.
BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000")
API_KEY = os.environ.get("LITELLM_API_KEY", "sk-1234")
MODEL = os.environ.get("MODEL", "gpt-4o-mini")
INTERVAL = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "30"))

client = openai.OpenAI(base_url=BASE_URL, api_key=API_KEY)

print(f"LiteLLM proxy test app starting -- calling {BASE_URL} every {INTERVAL}s")
i = 0
while True:
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=10,
        )
        print(f"[{i}] -> {resp.choices[0].message.content}")
    except Exception as e:
        print(f"[{i}] Error: {e}")
    i += 1
    time.sleep(INTERVAL)
