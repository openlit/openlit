import os
import time
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY") or "dummy")

print("Anthropic test app starting -- making calls every 45s")
i = 0
while True:
    try:
        resp = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=10,
            messages=[{"role": "user", "content": "hi"}],
        )
        print(f"[{i}] -> {resp.content[0].text}")
    except Exception as e:
        print(f"[{i}] Error: {e}")
    i += 1
    time.sleep(45)
