# OTel Span Events and Attributes: Implementation Guide

This document describes how OpenLIT implements OpenTelemetry (OTel) semantic conventions for GenAI spans and events, and how to adopt the same structure and style when adding or updating instrumentations (e.g., OpenAI → Anthropic, LiteLLM, etc.).

**Official OTel GenAI spec references:**

- [Semantic conventions for Generative AI events](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md) — event `gen_ai.client.inference.operation.details`, attribute requirement levels, well-known values.
- [Semantic conventions for generative client AI spans](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md) — inference/embeddings/retrieval spans, span name/kind, attributes, content recording.
- [GenAI docs (overview)](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) — input/output message schemas, system instructions, tool definitions.

---

## 1. How Span Attributes Look

Spans carry OTel-aligned attributes in a consistent order. Use **constants from `openlit.semcov.SemanticConvention`** so attribute names stay in sync with the official semconv and fallbacks.

### 1.1 Common attributes (set once per span)

Set these via **`common_span_attributes()`** from `openlit.__helpers` so all instrumentations behave the same:

| Attribute (constant) | Meaning |
|-----------------------|---------|
| `GEN_AI_OPERATION` | Operation type (e.g. `chat`, `embeddings`) |
| `GEN_AI_PROVIDER_NAME` | Provider name (e.g. `openai`, `anthropic`) |
| `SERVER_ADDRESS` / `SERVER_PORT` | Server connection |
| `GEN_AI_REQUEST_MODEL` / `GEN_AI_RESPONSE_MODEL` | Request and response model |
| `GEN_AI_REQUEST_IS_STREAM` | Whether the call was streaming |
| `GEN_AI_SERVER_TBT` / `GEN_AI_SERVER_TTFT` | Time-between-token / time-to-first-token |
| `GEN_AI_SDK_VERSION` | OpenLIT/instrumentation version |
| Plus: `DEPLOYMENT_ENVIRONMENT`, `SERVICE_NAME` (from helpers) |

**Usage:** Call `common_span_attributes(scope, gen_ai_operation, GEN_AI_SYSTEM_*, server_address, server_port, request_model, response_model, environment, application_name, is_stream, tbt, ttft, version)` at the start of your common logic.

### 1.2 Request and response attributes (on span)

Set these on `scope._span` after the common attributes:

- **Request:** `GEN_AI_REQUEST_TEMPERATURE`, `GEN_AI_REQUEST_TOP_P`, `GEN_AI_REQUEST_MAX_TOKENS`, `GEN_AI_REQUEST_FREQUENCY_PENALTY`, `GEN_AI_REQUEST_PRESENCE_PENALTY`, `GEN_AI_REQUEST_STOP_SEQUENCES`, `GEN_AI_REQUEST_SEED`, `GEN_AI_REQUEST_CHOICE_COUNT` (only when ≠ 1), `GEN_AI_REQUEST_USER`, etc.
- **Response:** `GEN_AI_RESPONSE_ID`, `GEN_AI_RESPONSE_FINISH_REASON` (array), `GEN_AI_OUTPUT_TYPE` (`text` or `json`).
- **Provider-specific (TIER 2):** e.g. OpenAI: `OPENAI_REQUEST_SERVICE_TIER`, `OPENAI_RESPONSE_SERVICE_TIER`, `GEN_AI_RESPONSE_SYSTEM_FINGERPRINT`.

Use helpers (e.g. `handle_not_given()` for OpenAI) so unset request fields get consistent defaults.

### 1.3 Usage and cost attributes (on span)

Always set these when you have the data (including when 0):

- `GEN_AI_USAGE_INPUT_TOKENS`
- `GEN_AI_USAGE_OUTPUT_TOKENS`
- `GEN_AI_CLIENT_TOKEN_USAGE` (input + output)
- `GEN_AI_USAGE_COST`
- **Cached tokens (set even when 0):**
  - `GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS`
  - `GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS`

Optional extensions (e.g. reasoning) can use spec-aligned or documented custom keys (e.g. `gen_ai.usage.reasoning_tokens`).

### 1.4 Message attributes (on span)

Per OTel, input/output messages on the **span** use the same **array structure** as on events:

- **`GEN_AI_INPUT_MESSAGES`** – JSON string of an array of input messages (role + parts).
- **`GEN_AI_OUTPUT_MESSAGES`** – JSON string of an array of output messages (role + parts + finish_reason).

Do **not** set these as ad-hoc strings. Use a single helper that takes structured message lists and sets both attributes so span and event stay consistent.

**Helper (per instrumentation):**

```python
def _set_span_messages_as_array(span, input_messages, output_messages):
    """Set gen_ai.input.messages and gen_ai.output.messages on span as JSON array strings (OTel)."""
    if input_messages is not None:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES,
            json.dumps(input_messages) if isinstance(input_messages, list) else input_messages,
        )
    if output_messages is not None:
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            json.dumps(output_messages) if isinstance(output_messages, list) else output_messages,
        )
```

Input/output message structures must follow the OTel gen-ai message schemas (e.g. `gen-ai-input-messages.json` / `gen-ai-output-messages.json`). Each provider implements **`build_input_messages(...)`** and **`build_output_messages(...)`** that return these structures; the same lists are then used for both span attributes and the inference event.

### 1.5 System instructions (on span)

When present, set **`GEN_AI_SYSTEM_INSTRUCTIONS`** (e.g. JSON string of instruction content). Source can be request system messages or a response field (e.g. Responses API `instructions`).

### 1.6 Tools (on span)

When the call involves tools, set:

- `GEN_AI_TOOL_NAME` (e.g. comma-separated names)
- `GEN_AI_TOOL_CALL_ID`
- `GEN_AI_TOOL_ARGS` (e.g. comma-separated string representation)

---

## 2. How Span Events Look

We emit a **single OTel GenAI inference-details event** per successful (or handled) invocation:

- **Event name:** `gen_ai.client.inference.operation.details`  
  Constant: **`SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS`**

- **Event attributes:** All inference details go in **attributes**; keep **body** empty (`""`) per spec.

### 2.1 Event attribute set

The event should carry the same semantic information as the span where applicable:

- **Operation / models:** `GEN_AI_OPERATION`, `GEN_AI_REQUEST_MODEL`, `GEN_AI_RESPONSE_MODEL`
- **Server:** `SERVER_ADDRESS`, `SERVER_PORT`
- **Messages:** `GEN_AI_INPUT_MESSAGES`, `GEN_AI_OUTPUT_MESSAGES` (same array structure as on span)
- **Tools:** `GEN_AI_TOOL_DEFINITIONS` when applicable
- **Request:** temperature, max_tokens, top_p, frequency_penalty, presence_penalty, stop_sequences, seed, choice_count
- **Response:** `GEN_AI_RESPONSE_ID`, `GEN_AI_RESPONSE_FINISH_REASON`, `GEN_AI_OUTPUT_TYPE`
- **Usage:** `GEN_AI_USAGE_INPUT_TOKENS`, `GEN_AI_USAGE_OUTPUT_TOKENS`, **`GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS`**, **`GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS`** (set even when 0)
- **Other:** `GEN_AI_SYSTEM_INSTRUCTIONS`, `ERROR_TYPE` (on error)

Use the **same attribute constants** as on the span so naming stays aligned with OTel.

### 2.2 Emitting the event

- Use a **single** helper (e.g. **`emit_inference_event()`**) that:
  - Takes `event_provider`, operation name, request/response model, input/output messages, tool definitions, server address/port, and **`**extra_attrs`** for the rest.
  - Maps **extra_attrs** keys to semantic convention attribute names (e.g. `cache_read_input_tokens` → `GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS`, `system_instructions` → `GEN_AI_SYSTEM_INSTRUCTIONS`, `error_type` → `ERROR_TYPE`).
  - Builds an OTel Event via **`otel_event(name, attributes, body="")`** from `openlit.__helpers` and calls **`event_provider.emit(event)`**.

- **Extra dict keys** (so call sites stay consistent across instrumentations):
  - `response_id`, `finish_reasons`, `output_type`, `temperature`, `max_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop_sequences`, `seed`, `choice_count` / `n`
  - `input_tokens`, `output_tokens`, **`cache_read_input_tokens`**, **`cache_creation_input_tokens`** (pass even when 0)
  - `system_instructions`, `error_type`

This keeps event payloads aligned with the span and makes it easy to add new instrumentations by filling the same `extra` shape and reusing the same emitter.

---

## 3. Official Spec Attribute Reference

The following tables align with the [GenAI events](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md) and [GenAI spans](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md) docs. Use these requirement levels and value types when implementing.

### 3.1 Event: `gen_ai.client.inference.operation.details`

| OTel attribute (key) | Requirement | Value type | Notes |
|----------------------|-------------|------------|--------|
| `gen_ai.operation.name` | **Required** | string | Well-known: `chat`, `embeddings`, `text_completion`, `generate_content`, etc. |
| `gen_ai.request.model` | Conditionally required if available | string | |
| `gen_ai.response.model` | Recommended | string | |
| `server.address` | Recommended | string | |
| `server.port` | Conditionally required if `server.address` set | int | |
| `gen_ai.request.temperature` | Recommended | double | |
| `gen_ai.request.top_p` | Recommended | double | |
| `gen_ai.request.max_tokens` | Recommended | int | |
| `gen_ai.request.frequency_penalty` | Recommended | double | |
| `gen_ai.request.presence_penalty` | Recommended | double | |
| `gen_ai.request.stop_sequences` | Recommended | string[] | |
| `gen_ai.request.seed` | Conditionally required if in request | int | |
| `gen_ai.request.choice.count` | Conditionally required if in request and ≠1 | int | |
| `gen_ai.response.id` | Recommended | string | |
| `gen_ai.response.finish_reasons` | Recommended | string[] | |
| `gen_ai.output.type` | Conditionally required when applicable | string | Well-known: `text`, `json`, `image`, `speech` |
| `gen_ai.usage.input_tokens` | Recommended | int | Should include cached tokens |
| `gen_ai.usage.output_tokens` | Recommended | int | |
| `gen_ai.usage.cache_creation.input_tokens` | Recommended | int | Set even when 0 |
| `gen_ai.usage.cache_read.input_tokens` | Recommended | int | Set even when 0 |
| `gen_ai.input.messages` | Opt-in | any | Structured on events; follow input-messages schema |
| `gen_ai.output.messages` | Opt-in | any | Structured on events; follow output-messages schema |
| `gen_ai.system_instructions` | Opt-in | any | Follow system-instructions schema |
| `gen_ai.tool.definitions` | Opt-in | any | Array of tool definitions |
| `gen_ai.conversation.id` | Conditionally required when available | string | |
| `error.type` | Conditionally required on error | string | Well-known: `_OTHER`; use exception type or provider error code |

### 3.2 Inference span (same attributes as above)

- **Span name:** `{gen_ai.operation.name} {gen_ai.request.model}` (e.g. `chat gpt-4o`).
- **Span kind:** `CLIENT` (or `INTERNAL` for in-process).
- **Span status:** Follow [Recording errors](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md).
- **Messages on span:** Per spec, `gen_ai.input.messages` / `gen_ai.output.messages` on spans MAY be a JSON string if structured format is not supported; on events they MUST be structured. OpenLIT uses JSON string on spans for compatibility.
- **Sampling:** Provide `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `server.address`, `server.port` at span creation time when possible.

### 3.3 Embeddings span

- `gen_ai.operation.name` = `embeddings`; span name = `embeddings {gen_ai.request.model}`.
- Attributes: `gen_ai.embeddings.dimension.count` (Recommended), `gen_ai.request.encoding_formats`, `gen_ai.usage.input_tokens`, plus common server/model/error attributes.

### 3.4 Well-known values (use these when applicable)

- **`error.type`:** `_OTHER` as fallback when no custom value.
- **`gen_ai.operation.name`:** `chat`, `embeddings`, `text_completion`, `generate_content`, `execute_tool`, `invoke_agent`, `create_agent`, `retrieval`.
- **`gen_ai.output.type`:** `text`, `json`, `image`, `speech`.
- **`gen_ai.provider.name`:** `openai`, `anthropic`, `aws.bedrock`, `gcp.gemini`, `azure.ai.openai`, etc. (see spans doc for full list).

---

## 4. Code and File Structure Reference

Keep **function names**, **argument order**, **comment headings**, and **sequence of operations** consistent across instrumentations so one pattern can be copied and maintained. The **reference implementation** is the OpenAI instrumentation: `sdk/python/src/openlit/instrumentation/openai/` (`utils.py`, `openai.py`, `async_openai.py`). New or updated instrumentations should mirror its structure, signatures, and comment style.

### 4.1 File layout (per provider)

- **`instrumentation/<provider>/`**
  - **`__init__.py`** – Instrumentor; wraps SDK entrypoints and passes `event_provider`, `capture_message_content`, etc., into the handler factory.
  - **`<provider>.py`** (e.g. `openai.py`) – Sync entrypoints that create span, extract request context, call into utils, and invoke **common_*_logic** with a **scope** object.
  - **`async_<provider>.py`** – Async counterparts.
  - **`utils.py`** – Shared helpers:
    - Provider-specific: `format_content`, `build_input_messages`, `build_output_messages`, `handle_not_given` (or equivalent), and any response/usage parsers.
    - Shared pattern: **`_set_span_messages_as_array(span, input_messages, output_messages)`**.
    - **`emit_inference_event(event_provider, operation_name, request_model, response_model, input_messages, output_messages, tool_definitions, server_address, server_port, **extra_attrs)`** – builds and emits the inference event with the key→OTel mapping above.

### 4.2 Function names and signatures (use exactly these names and argument order)

**In `openlit.__helpers` (reuse, do not redefine):** `common_span_attributes(scope, gen_ai_operation, GEN_AI_PROVIDER_NAME, server_address, server_port, request_model, response_model, environment, application_name, is_stream, tbt, ttft, version)` — docstring: "Set common span attributes for both chat and RAG operations."

**In each provider's `utils.py`:** `format_content(messages)`; `build_input_messages(messages)` (docstring: "Convert <Provider> request messages to OTel input message structure. Follows gen-ai-input-messages schema."); `build_output_messages(response_text, finish_reason, tool_calls=None)` (docstring: "Convert <Provider> response to OTel output message structure. Follows gen-ai-output-messages schema."); `_set_span_messages_as_array(span, input_messages, output_messages)` (docstring: "Set gen_ai.input.messages and gen_ai.output.messages on span as JSON array strings (OTel)."); `emit_inference_event(event_provider, operation_name, request_model, response_model, input_messages=None, output_messages=None, tool_definitions=None, server_address=None, server_port=None, **extra_attrs)` (docstring: "Emit gen_ai.client.inference.operation.details event.").

**Common logic names:** `common_chat_logic`, `common_response_logic`, `common_embedding_logic`. Signature: `(scope, pricing_info, environment, application_name, metrics, capture_message_content, disable_metrics, version, is_stream, event_provider=None)`. Docstring: "Process <op> request and generate Telemetry."

### 4.3 Scope attributes (naming: leading underscore)

Use a **scope** object (e.g. a simple type or namespace) to carry everything from “raw response + request” to “span + event”:

- **Request/context:** `_kwargs`, `_start_time`, `_end_time`, `_server_address`, `_server_port`, etc.
- **Parsed response:** `_response_id`, `_response_model`, `_llmresponse`, `_finish_reason`, `_tools` / `_response_tools`, `_operation_type` (if you have multiple APIs).
- **Usage:** `_input_tokens`, `_output_tokens`, **`_cache_read_input_tokens`**, **`_cache_creation_input_tokens`** (set in response parser even when 0).
- **Optional:** `_reasoning_tokens`, `_instructions`, `_system_fingerprint`, `_service_tier`, etc.
- **Span:** `_span` (set by the entrypoint).

Naming: **leading underscore** for scope attributes so it’s clear they are internal to the instrumentation flow.

### 4.4 Sequence of operations inside common_*_logic (exact order and comment style)

1. **Compute cost** — `cost = get_chat_model_cost(...)`.
2. **Common Span Attributes** — `common_span_attributes(scope, ...)`.
3. **Provider-specific API type** (if any) — e.g. comment: `# OpenAI-specific API type attribute`.
4. **Span Attributes for Request parameters** — temperature, top_p, max_tokens, frequency_penalty, presence_penalty, stop_sequences, seed, user, choice_count (only when ≠1).
5. **Span Attributes for Response parameters** — response_id, finish_reason (as array), output_type.
6. **Span Attributes for Tools** (if tools) — GEN_AI_TOOL_NAME, GEN_AI_TOOL_CALL_ID, GEN_AI_TOOL_ARGS.
7. **Span Attributes for Cost and Tokens** — GEN_AI_USAGE_INPUT_TOKENS, GEN_AI_USAGE_OUTPUT_TOKENS, GEN_AI_CLIENT_TOKEN_USAGE, GEN_AI_USAGE_COST.
8. **Reasoning tokens** (optional).
9. **OTel cached token attributes (set even when 0)** — GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS when scope has them.
10. **Span Attributes for Content** (only if `capture_message_content`) — build_input_messages, build_output_messages, _set_span_messages_as_array, GEN_AI_SYSTEM_INSTRUCTIONS; then **Emit inference event** with extra containing cache_read_input_tokens, cache_creation_input_tokens (even when 0), plus response_id, finish_reasons, output_type, temperature, max_tokens, top_p, input_tokens, output_tokens, system_instructions.
11. **Span status and metrics** — `scope._span.set_status(Status(StatusCode.OK))`, then `record_completion_metrics(...)` if not disable_metrics.

### 4.5 Response parsing (before calling common_*_logic)

Use comment: `# Handle token usage including reasoning tokens and cached tokens`. Parse usage dict; set `scope._input_tokens`, `scope._output_tokens`; from `output_tokens_details` set `scope._reasoning_tokens`; from `input_tokens_details` or `prompt_tokens_details` set `scope._cache_read_input_tokens = ... .get("cached_tokens", 0)`. Set `scope._cache_creation_input_tokens` if the API exposes it.

### 4.6 extra_attrs keys for emit_inference_event

Same keys across instrumentations: `response_id`, `finish_reasons`, `output_type`; `temperature`, `max_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop_sequences`, `seed`, `choice_count` or `n`; `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (always pass, even when 0); `system_instructions`, `error_type`, `conversation_id` (when available).

**Flow summary:** Entrypoint → create span, call SDK → normalize response to dict → build scope, parse usage/cache/messages → call common_*_logic → (cost → common_span_attributes → request/response/tools/usage/cache → content + emit_inference_event if capture_message_content → status + metrics). Streaming: accumulate then call common_*_logic once at the end.

---

## 5. Reusing and Sharing Code

### 5.1 From `openlit.__helpers`

- **`common_span_attributes(...)`** – Use for all instrumentations so common span attributes are identical.
- **`response_as_dict(response)`** – Use when the SDK returns an object; keeps parsing in utils dict-based.
- **`otel_event(name, attributes, body)`** – Use inside your `emit_inference_event`-style helper.
- **`calculate_ttft` / `calculate_tbt`** – For streaming metrics.
- **`get_chat_model_cost` / `get_embed_model_cost`** – For cost; provider-specific pricing can live in helpers or in the provider’s utils.
- **`record_completion_metrics`** – For metrics.
- **`handle_exception(span, e)`** – Set `error.type` and span status; use when you catch exceptions in the instrumentation.

### 5.2 From `openlit.semcov`

- **`SemanticConvention`** – Use for every attribute and event name (e.g. `GEN_AI_OPERATION`, `GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS`, `GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS`). Do not hardcode OTel strings in instrumentation code.

### 5.3 Provider-specific utils

- **`build_input_messages`** / **`build_output_messages`** – Provider-specific request/response shape → OTel message array. Same return shape across providers so **`_set_span_messages_as_array`** and **`emit_inference_event`** can stay shared or easily copied.
- **`emit_inference_event`** – Can live in the provider’s `utils.py` (as in OpenAI) with the **extra_attrs** key→OTel mapping documented above. New instrumentations should reuse the same **extra** keys and the same OTel attribute mapping so events look the same everywhere.
- **Cached tokens:** In the **response parsing** step, always set **`scope._cache_read_input_tokens`** (and **`scope._cache_creation_input_tokens`** if the API exposes it), defaulting to 0. Then in common_*_logic, set the span attributes when the scope has them (even when 0), and pass the same values in **extra** so the event gets them too.

---

## 6. Summary Checklist for New Instrumentations

- [ ] Use **`common_span_attributes()`** for base span attributes.
- [ ] Set **usage attributes** on the span (input/output tokens, cost, **cache_read** and **cache_creation** even when 0).
- [ ] Use **`_set_span_messages_as_array(span, input_messages, output_messages)`** with provider-specific **`build_input_messages`** / **`build_output_messages`** so **`gen_ai.input.messages`** and **`gen_ai.output.messages`** are JSON arrays on both span and event.
- [ ] Emit one **`gen_ai.client.inference.operation.details`** event per invocation via an **`emit_inference_event`**-style helper, with **extra** including **`cache_read_input_tokens`** and **`cache_creation_input_tokens`** (even when 0).
- [ ] Map **extra** keys to **`SemanticConvention`** constants inside the event helper (no raw OTel strings in call sites).
- [ ] Parse **cached token** fields from the provider’s usage object into **scope** and pass them through to both span and event.
- [ ] Use a **scope** object with underscored attributes and a single **common_*_logic** path so streaming and non-streaming share the same attribute and event logic.

This keeps span attributes and span events consistent across providers and aligned with OTel GenAI semantic conventions while preserving a clear, reusable code structure.
