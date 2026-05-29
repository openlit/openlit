import os
import time
import boto3

region = os.environ.get("AWS_REGION", "us-east-1")
model_id = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")

session = boto3.Session(region_name=region)
client = session.client(
    "bedrock-runtime",
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "random_key"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "random_key"),
    aws_session_token=os.environ.get("AWS_BEARER_BEDROCK_TOKEN", "random_key"),
)

print(f"Bedrock test app starting -- calling {model_id} every 45s")
i = 0
while True:
    try:
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": "hi"}]}],
            inferenceConfig={"maxTokens": 10},
        )
        text = resp["output"]["message"]["content"][0]["text"]
        print(f"[bedrock {i}] -> {text}")
    except Exception as e:
        print(f"[bedrock {i}] Error: {e}")
    i += 1
    time.sleep(45)
