"""
LangGraph Research Assistant Agent

A practical agent that takes a user question, searches the web for information,
extracts key facts, and produces a concise summary with sources. Demonstrates
tool usage, conditional routing, and state management in LangGraph.

Requirements:
    pip install langgraph langchain-openai langchain-community httpx

Set OPENAI_API_KEY in your environment before running.
"""

import json
import os
from datetime import datetime, timezone
from typing import Annotated, TypedDict

import httpx
from httpx._transports import default
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
import openlit

openlit.init(
    otlp_endpoint="https://ingress.europe-west4.gcp.dash0.com:4318",
    otlp_headers={"Authorization": "Bearer auth_W2ieunheYgu1oYxAA9I0G35dG8aOjtun"}
)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    search_results: list[dict]
    summary: str


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def web_search(query: str) -> str:
    """Search the web using DuckDuckGo Instant Answer API and return results."""
    url = "https://api.duckduckgo.com/"
    params = {"q": query, "format": "json", "no_html": 1, "skip_disambig": 1}
    resp = httpx.get(url, params=params, timeout=10, follow_redirects=True)
    data = resp.json()

    results: list[dict] = []
    if data.get("AbstractText"):
        results.append({"source": data.get("AbstractURL", ""), "text": data["AbstractText"]})
    for topic in data.get("RelatedTopics", [])[:5]:
        if "Text" in topic:
            results.append({"source": topic.get("FirstURL", ""), "text": topic["Text"]})

    if not results:
        return json.dumps({"results": [], "note": "No results found. Try rephrasing."})
    return json.dumps({"results": results})


@tool
def get_current_datetime() -> str:
    """Return the current UTC date and time."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression safely and return the result."""
    allowed = set("0123456789+-*/(). ")
    if not all(ch in allowed for ch in expression):
        return "Error: expression contains disallowed characters."
    try:
        result = eval(expression, {"__builtins__": {}})  # noqa: S307
        return str(result)
    except Exception as exc:
        return f"Error: {exc}"


TOOLS = [web_search, get_current_datetime, calculate]
TOOL_MAP = {t.name: t for t in TOOLS}


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------

def build_llm() -> ChatOpenAI:
    return ChatOpenAI(model="gpt-4o-mini", temperature=0).bind_tools(TOOLS)


SYSTEM_PROMPT = (
    "You are a helpful research assistant. When the user asks a question:\n"
    "1. Use `web_search` to find relevant information.\n"
    "2. Use `get_current_datetime` if the question involves dates or times.\n"
    "3. Use `calculate` for any arithmetic.\n"
    "4. After gathering information, provide a concise, well-structured summary "
    "with inline source URLs where applicable.\n"
    "Always cite your sources."
)


# ---------------------------------------------------------------------------
# Graph nodes
# ---------------------------------------------------------------------------

def agent_node(state: AgentState) -> dict:
    """Invoke the LLM with the current message history."""
    llm = build_llm()
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    response = llm.invoke(messages)
    return {"messages": [response]}


def tool_executor_node(state: AgentState) -> dict:
    """Execute every tool call requested by the last AI message."""
    last: AIMessage = state["messages"][-1]
    tool_messages = []
    for call in last.tool_calls:
        fn = TOOL_MAP[call["name"]]
        result = fn.invoke(call["args"])
        tool_messages.append(
            ToolMessage(content=str(result), tool_call_id=call["id"])
        )
    return {"messages": tool_messages}


def summarise_node(state: AgentState) -> dict:
    """Extract the final assistant answer into the summary field."""
    for msg in reversed(state["messages"]):
        if isinstance(msg, AIMessage) and msg.content:
            return {"summary": msg.content}
    return {"summary": ""}


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

def should_use_tools(state: AgentState) -> str:
    """Route to tool executor if the last message has tool calls."""
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"
    return "summarise"


# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------

def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_executor_node)
    graph.add_node("summarise", summarise_node)

    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_use_tools, {"tools": "tools", "summarise": "summarise"})
    graph.add_edge("tools", "agent")
    graph.add_edge("summarise", END)

    return graph.compile()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("Set OPENAI_API_KEY before running this script.")

    app = build_graph()

    print("Research Assistant (type 'quit' to exit)")
    print("-" * 45)

    while True:
        question = input("\nYou: ").strip()
        if not question or question.lower() in {"quit", "exit", "q"}:
            print("Goodbye!")
            break

        result = app.invoke(
            {"messages": [HumanMessage(content=question)], "search_results": [], "summary": ""},
        )

        print(f"\nAssistant:\n{result['summary']}")


if __name__ == "__main__":
    main()