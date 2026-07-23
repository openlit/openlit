"""mem0 + OpenLIT memory tracing example.

This self-contained script demonstrates how `openlit` automatically
instruments `mem0` memory operations and exports them as OpenTelemetry
spans with rich GenAI semantic-convention attributes.

The following memory operations are exercised, each of which is captured
as its own span by the openlit mem0 instrumentation:

    * ``Memory.add()``     -> span ``memory add``
    * ``Memory.search()``  -> span ``memory search``
    * ``Memory.get_all()`` -> span ``memory get_all``
    * ``Memory.delete()``  -> span ``memory delete``

Every span records provider/system attributes such as
``gen_ai.provider.name = mem0`` and ``gen_ai.operation.name = memory``, plus
operation-specific attributes (search query/limit, memory counts, result
counts, user id, and so on).

By default the example uses a local `Ollama <https://ollama.com>`_
configuration so it can run without any hosted API keys. If ``mem0`` is
configured to use a hosted LLM/embedder provider instead, set the matching
API key via environment variables (for example ``OPENAI_API_KEY``) before
running.

Run with::

    pip install -r requirements.txt
    python app.py
"""

import os
import sys

import openlit

# Initialize OpenLIT before importing/using mem0 so that the mem0
# instrumentation is applied to the Memory class. The OTLP endpoint points
# at a local OpenTelemetry collector (for example the openlit docker-compose
# stack listening on port 4318).
openlit.init(
    otlp_endpoint="http://localhost:4318",
    application_name="mem0-agent-demo",
    environment=os.environ.get("OTEL_ENVIRONMENT", "development"),
)

# mem0 is imported after openlit.init() so instrumentation is in place.
from mem0 import Memory  # noqa: E402  pylint: disable=wrong-import-position


# A fictional user we will attach memories to.
USER_ID = "alex-demo"


def build_memory():
    """Create a mem0 ``Memory`` instance.

    Uses a local Ollama-backed configuration so the example runs without any
    hosted API keys. Ollama must be running locally with the referenced
    models pulled (``ollama pull llama3.1`` and ``ollama pull nomic-embed-text``).

    Set ``MEM0_USE_DEFAULT=1`` to fall back to mem0's default configuration,
    which uses OpenAI and therefore requires ``OPENAI_API_KEY`` to be set.

    Returns:
        A configured ``mem0.Memory`` instance.
    """
    if os.getenv("MEM0_USE_DEFAULT"):
        # Default mem0 config: OpenAI LLM + embedder (needs OPENAI_API_KEY).
        return Memory()

    config = {
        "llm": {
            "provider": "ollama",
            "config": {
                "model": "llama3.1:latest",
                "temperature": 0,
                "ollama_base_url": os.getenv(
                    "OLLAMA_BASE_URL", "http://localhost:11434"
                ),
            },
        },
        "embedder": {
            "provider": "ollama",
            "config": {
                "model": "nomic-embed-text:latest",
                "ollama_base_url": os.getenv(
                    "OLLAMA_BASE_URL", "http://localhost:11434"
                ),
            },
        },
    }
    return Memory.from_config(config)


def add_memories(memory):
    """Add a few memories about the fictional user.

    Each ``Memory.add()`` call is traced as a ``memory add`` span. The span
    captures ``gen_ai.user.id``, the number of input messages
    (``gen_ai.memory.count``), and — when content capture is enabled — the
    raw input messages.

    Args:
        memory: The ``mem0.Memory`` instance to write to.
    """
    facts = [
        "My name is Alex and I am a backend engineer.",
        "I love hiking in the mountains on weekends.",
        "I am allergic to peanuts.",
        "I prefer dark roast coffee in the morning.",
    ]
    for fact in facts:
        memory.add(fact, user_id=USER_ID)
        print(f"[add]    stored: {fact}")


def search_memories(memory, query):
    """Search stored memories with a natural-language query.

    ``Memory.search()`` is traced as a ``memory search`` span, which records
    ``gen_ai.memory.search.query``, ``gen_ai.memory.search.limit``, and the
    number of results returned (``gen_ai.memory.operation.result_count``).

    Args:
        memory: The ``mem0.Memory`` instance to query.
        query: The natural-language search query.

    Returns:
        The raw search results returned by mem0.
    """
    results = memory.search(query=query, filters={"user_id": USER_ID}, top_k=3)
    print(f"[search] query={query!r} -> {results}")
    return results


def list_all_memories(memory):
    """List every memory stored for the user.

    ``Memory.get_all()`` is traced as a ``memory get_all`` span, recording
    the user id and the total number of memories returned.

    Args:
        memory: The ``mem0.Memory`` instance to read from.

    Returns:
        All memories stored for :data:`USER_ID`.
    """
    all_memories = memory.get_all(filters={"user_id": USER_ID})
    print(f"[get_all] {all_memories}")
    return all_memories


def delete_all_memories(memory, all_memories):
    """Delete each stored memory by id.

    Every ``Memory.delete()`` call is traced as a ``memory delete`` span,
    which records the deleted memory id (``db.delete.id``).

    Args:
        memory: The ``mem0.Memory`` instance to delete from.
        all_memories: The result of :func:`list_all_memories`, used to
            extract memory ids.
    """
    results = all_memories.get("results", []) if isinstance(all_memories, dict) else []
    for item in results:
        memory_id = item.get("id")
        if memory_id:
            memory.delete(memory_id=memory_id)
            print(f"[delete] removed memory id={memory_id}")


def main():
    """Run the end-to-end mem0 memory tracing demo.

    Exercises add/search/get_all/delete so that a full span hierarchy is
    exported to the configured OTLP endpoint.
    """
    try:
        memory = build_memory()
    except Exception as exc:  # pragma: no cover - environment dependent
        print(
            "Failed to initialize mem0.Memory. Make sure a local Ollama server "
            "is running (or set MEM0_USE_DEFAULT=1 with OPENAI_API_KEY).\n"
            f"Underlying error: {exc}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("== Adding memories ==")
    add_memories(memory)

    print("\n== Searching memories ==")
    search_memories(memory, "What food is Alex allergic to?")

    print("\n== Listing all memories ==")
    all_memories = list_all_memories(memory)

    print("\n== Deleting memories ==")
    delete_all_memories(memory, all_memories)

    print(
        "\nDone. Check your OpenTelemetry backend for spans named "
        "'memory add', 'memory search', 'memory get_all', and 'memory delete'."
    )


if __name__ == "__main__":
    main()
