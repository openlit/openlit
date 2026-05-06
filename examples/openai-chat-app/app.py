import os
import time
import openai

import openlit

openlit.init(otlp_endpoint="http://localhost:4318")

client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

print("OpenAI test app starting -- making calls every 45s")
i = 0
while True:
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=10,
        )
        print(f"[{i}] -> {resp.choices[0].message.content}")
    except Exception as e:
        print(f"[{i}] Error: {e}")
    i += 1
    time.sleep(45)
