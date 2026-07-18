"""
Agent Memory Read/Write Tracing Example
=======================================

This example demonstrates how to trace agent memory operations with the
OpenLIT Python SDK using its manual-tracing APIs:

  - ``openlit.start_trace()`` context manager for memory read/write spans,
    recording latency and hit/miss outcome per operation
  - ``@openlit.trace`` decorator for wrapping each agent turn so memory
    latency can be correlated with total turn latency in a single trace

The pattern applies whenever your agent uses a retrieval-augmented memory
layer (a vector store, Redis, Mem0, or a simple key-value store) and you want
to measure retrieval quality separately from LLM inference.

The script is fully self-contained: it uses an in-process memory store and a
stubbed response generator, so it runs without any API key. Spans are exported
to the OpenLIT collector at OTEL_EXPORTER_OTLP_ENDPOINT
(default: http://127.0.0.1:4318).

Usage:
  pip install -r requirements.txt
  python app.py

Span attributes to look for in the OpenLIT dashboard:
  memory.operation   "read" | "write"
  memory.hit         True when a read found a stored fact
  memory.age_s       seconds since the recalled fact was written
  memory.value_len   characters written on a write
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field

import openlit

openlit.init(
    application_name="agent-memory-tracing-demo",
    environment=os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "development"),
    otlp_endpoint=os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
    ),
)


# ---------------------------------------------------------------------------
# Minimal in-process memory store (swap in your vector DB / Mem0 / Redis)
# ---------------------------------------------------------------------------


@dataclass
class MemoryEntry:
    """A single stored memory fact with its lookup key and creation timestamp."""

    key: str
    value: str
    created_at: float = field(default_factory=time.time)


class SimpleMemoryStore:
    """
    A trivial key-value store that simulates an external memory backend.

    Each read/write is wrapped in an ``openlit.start_trace`` span so latency
    and hit/miss rates are visible per operation in the OpenLIT dashboard.
    """

    def __init__(self) -> None:
        """Initialize an empty in-process memory store."""
        self._store: dict[str, MemoryEntry] = {}

    def write(self, key: str, value: str) -> None:
        """
        Store a memory entry and emit a ``memory.write`` span.

        Span attributes:
          memory.operation  = "write"
          memory.key        = the lookup key
          memory.value_len  = number of characters written
        """
        with openlit.start_trace("memory.write") as span:
            self._store[key] = MemoryEntry(key=key, value=value)
            span.set_metadata(
                {
                    "memory.operation": "write",
                    "memory.key": key,
                    "memory.value_len": len(value),
                }
            )
            span.set_result("ok")

    def read(self, key: str) -> tuple[str | None, bool]:
        """
        Retrieve a memory entry and emit a ``memory.read`` span with
        hit/miss metadata.

        Span attributes:
          memory.operation  = "read"
          memory.key        = the lookup key
          memory.hit        = True when the key was found
          memory.age_s      = seconds since the entry was written (hits only)

        Returns:
            A ``(value, hit)`` tuple; ``value`` is None on a miss.
        """
        with openlit.start_trace("memory.read") as span:
            entry = self._store.get(key)
            metadata = {"memory.operation": "read", "memory.key": key}

            if entry is not None:
                metadata["memory.hit"] = True
                metadata["memory.age_s"] = round(time.time() - entry.created_at, 3)
                span.set_metadata(metadata)
                span.set_result(entry.value)
                return entry.value, True

            metadata["memory.hit"] = False
            span.set_metadata(metadata)
            span.set_result("miss")
            return None, False


# ---------------------------------------------------------------------------
# Stubbed response generator — replace with a real LLM call. When you use an
# OpenLIT-supported provider (OpenAI, Anthropic, etc.), openlit.init() above
# auto-instruments it and the LLM span nests inside the same agent turn trace.
# ---------------------------------------------------------------------------


def generate_response(system_context: str, user_message: str) -> str:
    """Return a canned assistant reply that reflects any recalled preference."""
    if "bullet" in system_context.lower():
        return "- OpenTelemetry gives vendor-neutral traces\n- Spans expose latency\n- Attributes carry hit/miss context"
    return (
        "OpenTelemetry provides vendor-neutral observability for LLM apps, "
        "capturing latency, token usage, and custom attributes in one trace."
    )


@openlit.trace
def run_agent_turn(memory: SimpleMemoryStore, user_message: str, session_id: str) -> str:
    """
    Simulate one agent turn:
      1. Read relevant memories before generating a response.
      2. Build a context-augmented system prompt.
      3. Generate the assistant reply (stub — swap in a real LLM call).
      4. Write new facts learned from this message back to memory.

    The ``@openlit.trace`` decorator wraps the whole turn in a parent span, so
    the nested memory.read / memory.write spans correlate with turn latency.
    """
    preference_key = f"{session_id}:user_preference"
    recalled_preference, hit = memory.read(preference_key)

    system_context = "You are a helpful assistant."
    if hit and recalled_preference:
        system_context += f" The user previously mentioned: {recalled_preference}"

    answer = generate_response(system_context, user_message)

    if "prefer" in user_message.lower() or "like" in user_message.lower():
        memory.write(preference_key, user_message[:120])

    return answer


# ---------------------------------------------------------------------------
# Demo: two sessions that demonstrate memory carry-over vs cold start
# ---------------------------------------------------------------------------


def main() -> None:
    """Run a three-turn demo showing memory write, memory hit, and cold-start miss."""
    mem = SimpleMemoryStore()
    session_id = str(uuid.uuid4())

    print("=== Turn 1 — introduce a preference (stored in memory) ===")
    t1_msg = "I prefer concise bullet-point answers over long prose."
    print(f"User:  {t1_msg}")
    print(f"Agent: {run_agent_turn(mem, t1_msg, session_id)}\n")

    print("=== Turn 2 — same session (memory hit shapes the answer) ===")
    t2_msg = "Summarise the benefits of OpenTelemetry for LLM applications."
    print(f"User:  {t2_msg}")
    print(f"Agent: {run_agent_turn(mem, t2_msg, session_id)}\n")

    print("=== Turn 3 — new session, no carry-over (cold-start miss) ===")
    t3_msg = "Summarise the benefits of OpenTelemetry for LLM applications."
    print(f"User:  {t3_msg}")
    print(f"Agent: {run_agent_turn(mem, t3_msg, str(uuid.uuid4()))}\n")

    print("Demo complete. In the OpenLIT dashboard, compare:")
    print("  - Turn 2: memory.hit=True  → context injected → bullet-point answer")
    print("  - Turn 3: memory.hit=False → cold start       → default prose answer")
    print("Track memory.hit and memory.age_s over time to measure retrieval quality.")


if __name__ == "__main__":
    main()
