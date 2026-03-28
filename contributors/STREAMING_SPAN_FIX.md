# Fix: Streaming Span Ordering Across All LLM Providers

## Problem

When OpenLIT instruments streaming LLM calls, the HTTP `POST` span (created by `opentelemetry-instrumentation-httpx` / `opentelemetry-instrumentation-requests` / etc.) should be a **child** of the OpenLIT `chat` span. This works correctly for **non-streaming** calls because the `chat` span is created via `tracer.start_as_current_span(...)` inside a `with` block — meaning it's the active span when `wrapped()` fires the HTTP request.

However, for **streaming** calls, the current code does:

```python
# BUG: wrapped() fires the HTTP POST *before* the span exists
awaited_wrapped = wrapped(*args, **kwargs)   # <-- HTTP POST happens here
span = tracer.start_span(span_name, kind=SpanKind.CLIENT)  # <-- span created after

return TracedSyncStream(awaited_wrapped, span, ...)
```

Because the `chat` span doesn't exist yet when `wrapped()` executes, the HTTP `POST` span has **no parent** and appears as a root span in a separate trace — breaking the span hierarchy.

### Non-streaming (correct)

```
invoke_agent
  └── chat gpt-4o-mini          ← start_as_current_span, then wrapped()
        └── POST https://...    ← correctly parented
```

### Streaming (buggy)

```
invoke_agent
  └── chat gpt-4o-mini          ← span created AFTER wrapped()

POST https://...                 ← orphaned root span, different trace
```

## Solution

Create the `chat` span **first**, attach it to the OTel context, **then** call `wrapped()`. Detach the context token immediately after `wrapped()` returns (the stream object is just initialized, the actual iteration happens later).

### Fixed pattern

```python
from opentelemetry import trace as trace_api, context as context_api

# ...

if streaming:
    # 1. Create span FIRST
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    # 2. Make it the active span so HTTP instrumentation picks it up
    ctx = trace_api.set_span_in_context(span)
    token = context_api.attach(ctx)
    try:
        # 3. NOW call wrapped — HTTP POST will be a child of our span
        awaited_wrapped = wrapped(*args, **kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(token)
        span.end()
        raise
    # 4. Detach — the span stays open, TracedStream will end it later
    context_api.detach(token)

    return TracedSyncStream(awaited_wrapped, span, ...)
```

### Streaming (fixed)

```
invoke_agent
  └── chat gpt-4o-mini          ← span created BEFORE wrapped()
        └── POST https://...    ← correctly parented
```

## Reference Implementation

The fix has already been applied to **OpenAI** (both sync and async). Use these as the canonical reference:

- `sdk/python/src/openlit/instrumentation/openai/openai.py` — sync: `chat_completions` and `responses` wrappers
- `sdk/python/src/openlit/instrumentation/openai/async_openai.py` — async: same two wrappers

---

## Files That Need the Fix

All files below follow the same buggy pattern: `wrapped()` is called before `tracer.start_span()`. Each entry documents the exact location and any provider-specific nuances.

### Batch 1: Anthropic & VertexAI

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/anthropic/anthropic.py` | `messages()` → `wrapper()` | Standard pattern. Add `trace_api`, `context_api` imports. |
| `instrumentation/anthropic/async_anthropic.py` | `messages()` → `async_wrapper()` | Same, but `await wrapped(...)`. |
| `instrumentation/vertexai/vertexai.py` | `generate_content()` → `wrapper()` | Standard pattern. |
| `instrumentation/vertexai/async_vertexai.py` | `generate_content()` → `async_wrapper()` | Async variant. |

**Current buggy code** (Anthropic sync example):

```python
if streaming:
    awaited_wrapped = wrapped(*args, **kwargs)
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

    return TracedSyncStream(awaited_wrapped, span, ...)
```

**Fixed code**:

```python
if streaming:
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    ctx = trace_api.set_span_in_context(span)
    token = context_api.attach(ctx)
    try:
        awaited_wrapped = wrapped(*args, **kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(token)
        span.end()
        raise
    context_api.detach(token)

    return TracedSyncStream(awaited_wrapped, span, ...)
```

### Batch 2: Together & Groq

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/together/together.py` | `chat_completions()` → `wrapper()` | Standard pattern. |
| `instrumentation/together/async_together.py` | `chat_completions()` → `async_wrapper()` | Async variant. |
| `instrumentation/groq/groq.py` | `chat_completions()` → `wrapper()` | Standard pattern. |
| `instrumentation/groq/async_groq.py` | `chat_completions()` → `async_wrapper()` | Async variant. |

Same fix pattern as Batch 1.

### Batch 3: AI21, Azure AI Inference & PremAI

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/ai21/ai21.py` | `chat()` → `wrapper()` | Standard pattern. |
| `instrumentation/ai21/async_ai21.py` | `chat()` → `async_wrapper()` | Async variant. |
| `instrumentation/azure_ai_inference/azure_ai_inference.py` | `complete()` → `wrapper()` | Standard pattern. |
| `instrumentation/azure_ai_inference/async_azure_ai_inference.py` | `complete()` → `async_wrapper()` | Async variant. |
| `instrumentation/premai/premai.py` | `chat_completions()` → `wrapper()` | Standard pattern (sync only, no async file). |

Same fix pattern as Batch 1.

### Batch 4: Sarvam & GPT4All

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/sarvam/sarvam.py` | `translate()` → `wrapper()` | **Already imports `context_api`** — only add `trace_api` import. |
| `instrumentation/sarvam/async_sarvam.py` | `translate()` → `async_wrapper()` | Same — `context_api` already present. |
| `instrumentation/gpt4all/gpt4all.py` | `chat_completions()` → `wrapper()` | Standard pattern. |

### Batch 5: Ollama (2 streaming paths per file)

| File | Functions | Notes |
|------|-----------|-------|
| `instrumentation/ollama/ollama.py` | `chat()` → `wrapper()` AND `generate()` → `wrapper()` | **Two** streaming blocks to fix per file. |
| `instrumentation/ollama/async_ollama.py` | `chat()` → `async_wrapper()` AND `generate()` → `async_wrapper()` | Same — two async streaming blocks. |

Each of the two wrapper functions (`chat` and `generate`) has its own `if streaming:` block that needs the fix.

### Batch 6: Mistral & Cohere (dedicated stream functions)

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/mistral/mistral.py` | `stream()` → `wrapper()` | This is a **dedicated streaming function** — no `if streaming:` check, the entire wrapper always streams. Apply the same span-first pattern. |
| `instrumentation/mistral/async_mistral.py` | `stream()` → `async_wrapper()` | Async variant of above. |
| `instrumentation/cohere/cohere.py` | `chat_stream()` → `wrapper()` | Dedicated streaming function, same approach. |
| `instrumentation/cohere/async_cohere.py` | `chat_stream()` → `async_wrapper()` | Async variant. |

**Current buggy code** (Mistral sync example):

```python
def wrapper(wrapped, instance, args, kwargs):
    # ...
    awaited_wrapped = wrapped(*args, **kwargs)
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

    return TracedSyncStream(awaited_wrapped, span, ...)
```

**Fixed code**:

```python
def wrapper(wrapped, instance, args, kwargs):
    # ...
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    ctx = trace_api.set_span_in_context(span)
    token = context_api.attach(ctx)
    try:
        awaited_wrapped = wrapped(*args, **kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(token)
        span.end()
        raise
    context_api.detach(token)

    return TracedSyncStream(awaited_wrapped, span, ...)
```

### Batch 7: LiteLLM, Bedrock & Google AI Studio (special patterns)

These providers have unique code structures requiring slightly different application of the fix.

#### LiteLLM

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/litellm/litellm.py` | `completion()` → `wrapper()` | Has `set_framework_llm_active()` / `reset_framework_llm_active()` calls around `wrapped()`. |
| `instrumentation/litellm/async_litellm.py` | `completion()` → `async_wrapper()` | Async variant with same pattern. |

**Current buggy code**:

```python
if streaming:
    fw_token = set_framework_llm_active()
    try:
        awaited_wrapped = wrapped(*args, **kwargs)
    finally:
        reset_framework_llm_active(fw_token)
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    return TracedSyncStream(awaited_wrapped, span, ...)
```

**Fixed code** — create span first, keep the `fw_token` logic intact:

```python
if streaming:
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    ctx = trace_api.set_span_in_context(span)
    otel_token = context_api.attach(ctx)
    fw_token = set_framework_llm_active()
    try:
        awaited_wrapped = wrapped(*args, **kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(otel_token)
        span.end()
        raise
    finally:
        reset_framework_llm_active(fw_token)
    context_api.detach(otel_token)
    return TracedSyncStream(awaited_wrapped, span, ...)
```

**Important**: The original code also has `reset_framework_llm_active(fw_token)` in both `except` and `finally` blocks elsewhere, causing a double-call on errors. When applying this fix, ensure `reset_framework_llm_active` is only in `finally` — never duplicated in `except`.

#### Bedrock

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/bedrock/bedrock.py` | `converse_stream()` → `converse_stream_wrapper()` | Uses `original_method(...)` instead of `wrapped(...)`. The wrapper is nested inside the main `wrapper()` function. |

**Current buggy code**:

```python
def converse_stream_wrapper(original_method, *method_args, **method_kwargs):
    # ...
    stream_response = original_method(*method_args, **method_kwargs)
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

    return TracedSyncStream(stream_response, span, ...)
```

**Fixed code**:

```python
def converse_stream_wrapper(original_method, *method_args, **method_kwargs):
    # ...
    span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
    ctx = trace_api.set_span_in_context(span)
    token = context_api.attach(ctx)
    try:
        stream_response = original_method(*method_args, **method_kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(token)
        span.end()
        raise
    context_api.detach(token)

    return TracedSyncStream(stream_response, span, ...)
```

#### Google AI Studio

| File | Function | Notes |
|------|----------|-------|
| `instrumentation/google_ai_studio/google_ai_studio.py` | `generate_stream()` → `wrapper()` | Uses `tracer.start_as_current_span(...)` without a `with` block — needs to be changed to `tracer.start_span(...)` + explicit `attach/detach`. |
| `instrumentation/google_ai_studio/async_google_ai_studio.py` | `generate_stream()` → `async_wrapper()` | Async variant with same issue. |

**Current buggy code**:

```python
awaited_wrapped = wrapped(*args, **kwargs)
span = tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT)

return TracedSyncStream(awaited_wrapped, span, ...)
```

**Fixed code**:

```python
span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
ctx = trace_api.set_span_in_context(span)
token = context_api.attach(ctx)
try:
    awaited_wrapped = wrapped(*args, **kwargs)
except Exception as e:
    handle_exception(span, e)
    context_api.detach(token)
    span.end()
    raise
context_api.detach(token)

return TracedSyncStream(awaited_wrapped, span, ...)
```

**Note**: `start_as_current_span` without `with` returns a context manager, not a span — so `TracedSyncStream` would receive the wrong type. The fix switches to `start_span` which correctly returns a `Span` object.

---

## Import Changes Required

For every file that gets this fix, ensure these imports are present at the top:

```python
from opentelemetry import trace as trace_api, context as context_api
```

**Exceptions**:
- `sarvam/sarvam.py` and `sarvam/async_sarvam.py` already import `context as context_api` — only add `trace as trace_api`
- `openai/openai.py` and `openai/async_openai.py` already have both imports (fix is already applied)

---

## Complete File List (27 call sites across 25 files)

All paths are relative to `sdk/python/src/openlit/`:

| # | File | Streaming call sites |
|---|------|---------------------|
| 1 | `instrumentation/anthropic/anthropic.py` | 1 |
| 2 | `instrumentation/anthropic/async_anthropic.py` | 1 |
| 3 | `instrumentation/vertexai/vertexai.py` | 1 |
| 4 | `instrumentation/vertexai/async_vertexai.py` | 1 |
| 5 | `instrumentation/together/together.py` | 1 |
| 6 | `instrumentation/together/async_together.py` | 1 |
| 7 | `instrumentation/groq/groq.py` | 1 |
| 8 | `instrumentation/groq/async_groq.py` | 1 |
| 9 | `instrumentation/ai21/ai21.py` | 1 |
| 10 | `instrumentation/ai21/async_ai21.py` | 1 |
| 11 | `instrumentation/azure_ai_inference/azure_ai_inference.py` | 1 |
| 12 | `instrumentation/azure_ai_inference/async_azure_ai_inference.py` | 1 |
| 13 | `instrumentation/premai/premai.py` | 1 |
| 14 | `instrumentation/sarvam/sarvam.py` | 1 |
| 15 | `instrumentation/sarvam/async_sarvam.py` | 1 |
| 16 | `instrumentation/gpt4all/gpt4all.py` | 1 |
| 17 | `instrumentation/ollama/ollama.py` | 2 (chat + generate) |
| 18 | `instrumentation/ollama/async_ollama.py` | 2 (chat + generate) |
| 19 | `instrumentation/mistral/mistral.py` | 1 (dedicated `stream()`) |
| 20 | `instrumentation/mistral/async_mistral.py` | 1 (dedicated `stream()`) |
| 21 | `instrumentation/cohere/cohere.py` | 1 (dedicated `chat_stream()`) |
| 22 | `instrumentation/cohere/async_cohere.py` | 1 (dedicated `chat_stream()`) |
| 23 | `instrumentation/litellm/litellm.py` | 1 (has `fw_token` logic) |
| 24 | `instrumentation/litellm/async_litellm.py` | 1 (has `fw_token` logic) |
| 25 | `instrumentation/bedrock/bedrock.py` | 1 (`converse_stream_wrapper`) |
| 26 | `instrumentation/google_ai_studio/google_ai_studio.py` | 1 (`start_as_current_span` → `start_span`) |
| 27 | `instrumentation/google_ai_studio/async_google_ai_studio.py` | 1 (`start_as_current_span` → `start_span`) |

**Total: 27 call sites across 25 files** (Ollama has 2 per file).

---

## Verification

After applying the fix to each provider, verify with a streaming call:

1. Enable HTTP instrumentation (e.g., `opentelemetry-instrumentation-httpx` for httpx-based SDKs, or `opentelemetry-instrumentation-requests` for requests-based SDKs)
2. Make a streaming API call through the provider
3. Check that the `POST` span is a **child** of the `chat` span, not a root span
4. Confirm the `chat` span has correct attributes (model, tokens, finish_reason, etc.)
5. Confirm non-streaming calls still work correctly (they should be unaffected)
