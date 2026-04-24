import os
import time
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

endpoint = os.environ.get("AZURE_INFERENCE_ENDPOINT", "https://models.inference.ai.azure.com")
api_key = os.environ["AZURE_INFERENCE_API_KEY"]
model = os.environ.get("AZURE_INFERENCE_MODEL", "gpt-4o-mini")

client = ChatCompletionsClient(endpoint=endpoint, credential=AzureKeyCredential(api_key))

print(f"Azure AI Inference test app starting -- calling {model} every 45s")
i = 0
while True:
    try:
        resp = client.complete(
            model=model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=10,
        )
        text = resp.choices[0].message.content
        tokens_in = resp.usage.prompt_tokens
        tokens_out = resp.usage.completion_tokens
        print(f"[{i}] -> {text}  (in={tokens_in} out={tokens_out})")
    except Exception as e:
        print(f"[{i}] Error: {e}")
    i += 1
    time.sleep(45)
