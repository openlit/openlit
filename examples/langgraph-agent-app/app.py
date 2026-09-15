"""LangGraph agent sample — instrumented with openlit.init() only."""
import os
import time
from pathlib import Path
from typing import Annotated, TypedDict

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import openlit

if not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit("OPENAI_API_KEY missing — set it in the repo root .env")

OTLP_ENDPOINT = os.environ.get(
    "OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
)
SERVICE_NAME = os.environ.get("OPENLIT_SERVICE_NAME", "langgraph-agent-app")
ENVIRONMENT = os.environ.get("OPENLIT_ENVIRONMENT", "default")
INTERVAL = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "30"))
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

openlit.init(
    service_name=SERVICE_NAME,
    environment=ENVIRONMENT,
    otlp_endpoint=OTLP_ENDPOINT,
)

from langchain_core.messages import HumanMessage  # noqa: E402
from langchain_openai import ChatOpenAI  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.graph.message import add_messages  # noqa: E402


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]


llm = ChatOpenAI(model=MODEL, temperature=0.2)


def researcher(state: AgentState) -> dict:
    """First node: gather a short research note."""
    response = llm.invoke(
        [
            {
                "role": "system",
                "content": (
                    "You are a research node. Reply with one short factual sentence."
                ),
            },
            *state["messages"],
        ]
    )
    return {"messages": [response]}


def summarizer(state: AgentState) -> dict:
    """Second node: compress the research into a tweet-length summary."""
    response = llm.invoke(
        [
            {
                "role": "system",
                "content": (
                    "You are a summarizer. Turn the prior research into one tweet "
                    "(under 200 characters)."
                ),
            },
            *state["messages"],
        ]
    )
    return {"messages": [response]}


builder = StateGraph(AgentState)
builder.add_node("researcher", researcher)
builder.add_node("summarizer", summarizer)
builder.add_edge(START, "researcher")
builder.add_edge("researcher", "summarizer")
builder.add_edge("summarizer", END)
graph = builder.compile()

PROMPTS = [
    "Interesting fact about LLM observability in production.",
    "Why agent traces help debug tool-calling failures.",
    "One benefit of OpenTelemetry for multi-agent systems.",
]

print(
    f"[langgraph-agent-app] starting → OTLP {OTLP_ENDPOINT} "
    f"service={SERVICE_NAME} every {INTERVAL}s"
)

i = 0
while True:
    prompt = PROMPTS[i % len(PROMPTS)]
    try:
        result = graph.invoke({"messages": [HumanMessage(content=prompt)]})
        last = result["messages"][-1]
        text = getattr(last, "content", str(last))[:120]
        print(f"[{i}] -> {text}")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[{i}] Error: {exc}")
    i += 1
    time.sleep(INTERVAL)
