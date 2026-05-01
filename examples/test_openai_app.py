"""
Simple test app that calls OpenAI models via the openlit SDK.
Sends telemetry to a local OpenLIT instance.

Usage:
    export OPENAI_API_KEY=sk-...
    pip install openai openlit
    python examples/test_openai_app.py
"""

import os
import time

import openai
import openlit

openlit.init(
    otlp_endpoint="http://localhost:4318",
    application_name="test-openai-app",
)

client = openai.OpenAI()


def chat_completion():
    print("[1/3] Running chat completion (gpt-4o-mini)...")
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is eBPF and why is it useful for observability?"},
        ],
        max_tokens=200,
    )
    print(f"  -> {resp.choices[0].message.content[:120]}...\n")
    return resp


def chat_with_tools():
    print("[2/3] Running chat completion with tool calling...")
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "City name"},
                    },
                    "required": ["location"],
                },
            },
        }
    ]
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "What's the weather in San Francisco?"}],
        tools=tools,
        max_tokens=200,
    )
    if resp.choices[0].message.tool_calls:
        print(f"  -> Tool call: {resp.choices[0].message.tool_calls[0].function.name}"
              f"({resp.choices[0].message.tool_calls[0].function.arguments})\n")
    else:
        print(f"  -> {resp.choices[0].message.content[:120]}...\n")
    return resp


def embeddings():
    print("[3/3] Running embeddings (text-embedding-3-small)...")
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=["OpenLIT provides observability for LLM applications"],
    )
    print(f"  -> Embedding dim: {len(resp.data[0].embedding)}\n")
    return resp


def main():
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("Set OPENAI_API_KEY before running this script.")

    print("=" * 60)
    print("OpenLIT Test App -- Sending telemetry to http://localhost:4318")
    print("=" * 60 + "\n")

    chat_completion()
    time.sleep(1)
    chat_with_tools()
    time.sleep(1)
    embeddings()

    print("=" * 60)
    print("Done! Check OpenLIT at http://localhost:3000 to see traces.")
    print("=" * 60)


if __name__ == "__main__":
    main()
