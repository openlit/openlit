import os
import time
import openai

client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", "random_key"))

print("OpenAI test app starting -- making calls every 45s")
i = 0
while True:
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=10,
        )
        print(f"[openai {i}] -> {resp.choices[0].message.content}")
    except Exception as e:
        print(f"[openai {i}] Error: {e}")
    i += 1
    time.sleep(45)
