import os
import time
from google import genai

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", "random_key"))

print("Gemini test app starting -- making calls every 45s")
i = 0
while True:
    try:
        resp = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents="hi",
            config={"max_output_tokens": 10},
        )
        print(f"[gemini {i}] -> {resp.text}")
    except Exception as e:
        print(f"[gemini {i}] Error: {e}")
    i += 1
    time.sleep(45)
