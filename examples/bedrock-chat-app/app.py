import os
import time
import requests

token = os.environ["AWS_BEARER_BEDROCK_TOKEN"]
region = os.environ.get("AWS_REGION", "us-east-1")
model_id = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")

url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/converse"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}

body = {
    "messages": [{"role": "user", "content": [{"text": "hi"}]}],
    "inferenceConfig": {"maxTokens": 10},
}

print(f"Bedrock test app starting -- calling {model_id} every 45s")
i = 0
while True:
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        text = data["output"]["message"]["content"][0]["text"]
        tokens_in = data["usage"]["inputTokens"]
        tokens_out = data["usage"]["outputTokens"]
        print(f"[{i}] -> {text}  (in={tokens_in} out={tokens_out})")
    except Exception as e:
        print(f"[{i}] Error: {e}")
    i += 1
    time.sleep(45)
