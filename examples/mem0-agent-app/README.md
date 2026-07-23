# mem0 Agent Memory Tracing with OpenLIT

This example demonstrates how [OpenLIT](https://openlit.io) automatically
instruments [mem0](https://mem0.ai) memory operations and exports them as
[OpenTelemetry](https://opentelemetry.io) spans — giving you full visibility
into the memory read/write patterns of your LLM agents.

Agent memory is a growing observability need: when an agent adds, searches,
and prunes memories, you want those operations to show up in your traces right
alongside your LLM spans. OpenLIT's mem0 instrumentation does this
automatically — no manual span creation required.

## What this example demonstrates

The [`app.py`](./app.py) script exercises the core `mem0` memory operations,
each of which is captured as its own span by OpenLIT:

| mem0 call            | Span name           | What it captures                                     |
| -------------------- | ------------------- | ---------------------------------------------------- |
| `Memory.add()`       | `memory add`        | user id, input message count, (optional) raw input   |
| `Memory.search()`    | `memory search`     | search query, limit, threshold, result count         |
| `Memory.get_all()`   | `memory get_all`    | user id, number of memories returned                 |
| `Memory.delete()`    | `memory delete`     | deleted memory id                                     |

## Prerequisites

- Python 3.10+ (required by mem0)
- An OpenTelemetry-compatible backend listening on `http://localhost:4318`
  (for example, the [OpenLIT docker-compose stack](https://docs.openlit.io/latest/quickstart)).
- A model backend for mem0. By default this example uses a local
  [Ollama](https://ollama.com) server so it runs **without any hosted API keys**:

  ```bash
  ollama pull llama3.1
  ollama pull nomic-embed-text
  ```

  The default Ollama path requires the `ollama` Python package (listed in
  `requirements.txt`), which is installed by the `pip install` step below.

  Alternatively, set `MEM0_USE_DEFAULT=1` to use mem0's default OpenAI-backed
  configuration, in which case you must export `OPENAI_API_KEY`.

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

The script prints each memory operation as it runs and then flushes the spans
to your OTLP endpoint.

## Expected OpenTelemetry attributes

Every mem0 span emitted by OpenLIT includes a common set of GenAI semantic
convention attributes, for example:

- `gen_ai.provider.name = mem0`
- `gen_ai.operation.name = memory` (user-facing memory operations)
- `gen_ai.user.id = alex-demo`
- `service.name = mem0-agent-demo`
- `deployment.environment = development`

Operation-specific attributes are added on top, such as:

- `gen_ai.memory.count` on `memory add`
- `gen_ai.memory.search.query`, `gen_ai.memory.search.limit` on `memory search`
- `gen_ai.memory.operation.result_count` on `memory search` / `memory get_all`
- `db.delete.id` on `memory delete`

If content capture is enabled in `openlit.init(...)`, the raw input messages
(`gen_ai.input.messages`) and search results (`gen_ai.output.messages`) are
captured as well.

## Learn more

- [OpenLIT documentation](https://docs.openlit.io)
- [OpenLIT mem0 integration](https://docs.openlit.io/latest/sdk/integrations/mem0)
- [mem0 documentation](https://docs.mem0.ai)
