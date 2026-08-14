"""
Sample OpenLIT-SDK-instrumented agent.

Boots an in-process OpenAI-compatible mock LLM (so the example runs without any
real API key), points the OpenAI client at it, and exercises a "travel-assistant"
agent with a stable system prompt and two tools on a loop. Spans are emitted
through openlit's auto-instrumented openai integration to the OpenLIT collector
at OTEL_EXPORTER_OTLP_ENDPOINT (default: http://openlit:4318), so the app shows
up on the Agents page as an SDK-sourced agent with full system prompt, tools,
and runtime config.
"""

import itertools
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import openai
import openlit


_MOCK_REQUEST_COUNTER = itertools.count(0)


# ──────────────────────────────────────────────────────────────────────────────
# Tiny in-process OpenAI-compatible mock LLM
#
# We need the chat.completions call to *succeed* so openlit's instrumentation
# captures the rich agent attributes (system_instructions, tool definitions,
# tool calls, model, temperature, top_p, max_tokens). Pointing at api.openai.com
# with a fake key would fail before any of that gets recorded.
# ──────────────────────────────────────────────────────────────────────────────

MOCK_PORT = int(os.environ.get("MOCK_LLM_PORT", "8088"))
MOCK_HOST = os.environ.get("MOCK_LLM_HOST", "127.0.0.1")


def _build_mock_response(body: dict) -> dict:
    model = body.get("model", "gpt-4o-mini")
    tools = body.get("tools") or []
    # Alternate between a plain reply and a tool call so the Conversations tab
    # has both shapes to render. Uses a per-request counter (not wall-clock
    # parity, which can lock to a single branch when requests are spaced
    # evenly).
    use_tool = bool(tools) and (next(_MOCK_REQUEST_COUNTER) % 2 == 0)
    if use_tool:
        tool = tools[0]["function"]
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": f"call_{uuid.uuid4().hex[:10]}",
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "arguments": json.dumps({"city": "Tokyo"}),
                    },
                }
            ],
        }
        finish = "tool_calls"
    else:
        message = {
            "role": "assistant",
            "content": (
                "Tokyo in spring is fantastic — cherry blossoms peak late March "
                "to early April. Want me to suggest a 3-day itinerary?"
            ),
        }
        finish = "stop"

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {
            "prompt_tokens": 64,
            "completion_tokens": 24,
            "total_tokens": 88,
            # openlit's openai instrumentation calls `.get("cached_tokens", 0)`
            # on this dict; if the field is missing the OpenAI Python client
            # defaults the parsed value to None and the SDK trips an
            # AttributeError. Returning an empty dict keeps it happy.
            "prompt_tokens_details": {"cached_tokens": 0},
        },
    }


class _MockHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802  (HTTPServer naming convention)
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            body = {}
        payload = json.dumps(_build_mock_response(body)).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args, **_kwargs):
        # Silence the default request-log spam so app logs stay readable.
        return


def _start_mock_server() -> None:
    httpd = ThreadingHTTPServer((MOCK_HOST, MOCK_PORT), _MockHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="mock-llm")
    thread.start()
    print(f"[mock-llm] listening on http://{MOCK_HOST}:{MOCK_PORT}/v1")


_start_mock_server()


# ──────────────────────────────────────────────────────────────────────────────
# OpenLIT SDK initialization
# ──────────────────────────────────────────────────────────────────────────────

SERVICE_NAME = os.environ.get("OPENLIT_SERVICE_NAME", "travel-assistant")
ENVIRONMENT = os.environ.get("OPENLIT_ENVIRONMENT", "default")
OTLP_ENDPOINT = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://openlit:4318")

openlit.init(
    service_name=SERVICE_NAME,
    environment=ENVIRONMENT,
    otlp_endpoint=OTLP_ENDPOINT,
)
print(
    f"[openlit] initialized service='{SERVICE_NAME}' env='{ENVIRONMENT}' "
    f"otlp='{OTLP_ENDPOINT}'"
)


# ──────────────────────────────────────────────────────────────────────────────
# Agent definition
# ──────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a concise travel assistant. When the user asks about a destination, "
    "use the lookup_weather tool to fetch the current forecast, and use the "
    "find_hotels tool to surface 2-3 stay options. Always end with one short "
    "follow-up question that helps the traveller narrow their plan."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_weather",
            "description": "Get the current weather forecast for a destination city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name, e.g. 'Tokyo'.",
                    },
                    "units": {
                        "type": "string",
                        "enum": ["metric", "imperial"],
                        "default": "metric",
                    },
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_hotels",
            "description": "Search hotels in a city with optional star rating and budget.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "min_stars": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 3,
                    },
                    "max_price_usd": {"type": "number"},
                },
                "required": ["city"],
            },
        },
    },
]

USER_PROMPTS = [
    "Plan a 3-day trip to Tokyo.",
    "What's a good weekend in Lisbon?",
    "Suggest a beach getaway in Goa under $200/night.",
    "Plan a winter trip to Reykjavik with northern-lights stops.",
]

REQUEST_INTERVAL_SECONDS = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "20"))
MODEL = os.environ.get("AGENT_MODEL", "gpt-4o-mini")

client = openai.OpenAI(
    api_key="sk-mock-not-real",
    base_url=f"http://{MOCK_HOST}:{MOCK_PORT}/v1",
)

print(
    f"[agent] starting -- calling chat.completions every "
    f"{REQUEST_INTERVAL_SECONDS}s with model='{MODEL}'"
)

i = 0
while True:
    prompt = USER_PROMPTS[i % len(USER_PROMPTS)]
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.2,
            top_p=0.95,
            max_tokens=256,
        )
        choice = resp.choices[0].message
        if choice.tool_calls:
            names = ", ".join(tc.function.name for tc in choice.tool_calls)
            print(f"[{i}] tool_call -> {names}")
        else:
            print(f"[{i}] reply -> {(choice.content or '')[:80]}")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[{i}] error: {exc}")
    i += 1
    time.sleep(REQUEST_INTERVAL_SECONDS)
