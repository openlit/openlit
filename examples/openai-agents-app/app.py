"""OpenAI Agents SDK sample — instrumented with openlit.init() only."""
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import openlit

if not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit("OPENAI_API_KEY missing — set it in the repo root .env")

OTLP_ENDPOINT = os.environ.get(
    "OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
)
SERVICE_NAME = os.environ.get("OPENLIT_SERVICE_NAME", "openai-agents-app")
ENVIRONMENT = os.environ.get("OPENLIT_ENVIRONMENT", "default")
INTERVAL = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "30"))
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

openlit.init(
    service_name=SERVICE_NAME,
    environment=ENVIRONMENT,
    otlp_endpoint=OTLP_ENDPOINT,
)

from agents import Agent, Runner, function_tool  # noqa: E402  — after openlit.init()


@function_tool
def lookup_fact(topic: str) -> str:
    """Return a short canned fact about a topic."""
    facts = {
        "observability": "LLM observability captures traces, costs, and tool calls for agent runs.",
        "tracing": "Distributed tracing links parent agent spans to nested LLM and tool spans.",
        "otel": "OpenTelemetry is the standard for exporting traces and metrics from apps.",
    }
    key = topic.strip().lower()
    for k, v in facts.items():
        if k in key:
            return v
    return f"No canned fact for '{topic}'. Prefer concise answers."


agent = Agent(
    name="Observability Assistant",
    instructions=(
        "You are a concise observability assistant. "
        "When useful, call lookup_fact. Reply in one or two short sentences."
    ),
    tools=[lookup_fact],
    model=MODEL,
)

PROMPTS = [
    "What is LLM observability? Use the tool if helpful.",
    "Why does tracing matter for agents?",
    "Give me one sentence on OpenTelemetry for AI apps.",
]

print(
    f"[openai-agents-app] starting → OTLP {OTLP_ENDPOINT} "
    f"service={SERVICE_NAME} every {INTERVAL}s"
)

i = 0
while True:
    prompt = PROMPTS[i % len(PROMPTS)]
    try:
        result = Runner.run_sync(agent, prompt)
        text = (result.final_output or "")[:120]
        print(f"[{i}] -> {text}")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[{i}] Error: {exc}")
    i += 1
    time.sleep(INTERVAL)
