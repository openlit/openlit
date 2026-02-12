# OpenTelemetry Events Migration Guide

This guide documents the migration pattern from span events to OTel log events for LLM instrumentation, following the [OpenTelemetry Gen-AI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md).

**Reference Implementation:** OpenAI instrumentation (completed)
**Status:** Production-ready pattern for adoption across all providers

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Decisions](#architecture-decisions)
3. [Implementation Pattern](#implementation-pattern)
4. [Code Examples](#code-examples)
5. [Testing Checklist](#testing-checklist)
6. [Provider-Specific Notes](#provider-specific-notes)

---

## Overview

### What Changed

**Before:** Prompt and response content emitted as span events using `span.add_event()`
```python
# OLD - To be removed
span.add_event(
    name="gen_ai.content.prompt",
    attributes={"gen_ai.prompt": json.dumps(messages)}
)
```

**After:** Content emitted as OTel log events using the events provider
```python
# NEW - Following OTel Gen-AI spec
event = otel_event(
    name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
    attributes={
        SemanticConvention.GEN_AI_INPUT_MESSAGES: input_messages,  # Structured, not JSON string
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES: output_messages,
        # ... other attributes
    },
    body=""
)
event_provider.emit(event)
```

### Why This Matters

1. **Compliance:** Aligns with OTel Gen-AI semantic conventions v1.29+
2. **Structure:** Messages as structured objects (not JSON strings)
3. **Standardization:** Consistent event format across all providers
4. **Observability:** Better integration with OTel backends
5. **Future-proof:** Prepares for span events deprecation

---

## Architecture Decisions

### 1. Event Name

**Use:** `gen_ai.client.inference.operation.details`
**For:** All operations (chat, completions, embeddings, image, audio)

```python
SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS = "gen_ai.client.inference.operation.details"
```

### 2. Message Format

**Critical:** Use structured objects, NOT JSON strings

```python
# ✅ CORRECT - Structured objects
input_messages = [
    {
        "role": "user",
        "parts": [{"type": "text", "content": "Hello"}]
    }
]

# ❌ WRONG - JSON strings
input_messages = json.dumps([...])  # Never do this!
```

### 3. Event Emission Timing

**When:** After receiving complete response (including streaming)

- **Non-streaming:** Emit immediately after response
- **Streaming:** Emit in StopIteration handler after all chunks collected

### 4. Attribute Mapping

**Required Attributes:**
- `gen_ai.operation` (chat, completion, embedding, etc.)
- `gen_ai.request.model`
- `gen_ai.response.model`
- `gen_ai.input.messages` (for chat/completions)
- `gen_ai.output.messages` (for chat/completions)

**Recommended Attributes:**
- `gen_ai.system_instructions` (if system messages present)
- `gen_ai.tool.definitions` (if tools/functions provided)
- `gen_ai.response.id`
- `gen_ai.response.finish_reasons[]`
- `server.address`, `server.port`

**Optional Attributes:**
- `gen_ai.request.temperature`
- `gen_ai.request.max_tokens`
- `gen_ai.request.top_p`
- `gen_ai.request.frequency_penalty`
- `gen_ai.request.presence_penalty`
- `gen_ai.request.stop_sequences[]`
- `gen_ai.request.seed`
- `gen_ai.response.choice_count`
- `gen_ai.response.output_type`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`

### 5. Backward Compatibility

**Keep existing span attributes** - DO NOT REMOVE:
- `gen_ai.prompt` (legacy)
- `gen_ai.completion` (legacy)
- All metrics
- All existing span attributes

**Only remove:** `span.add_event()` calls

---

## Implementation Pattern

### Step-by-Step Migration

#### Phase 1: Add Semantic Conventions

**File:** `src/openlit/semcov/__init__.py`

```python
# Add these constants after existing gen_ai constants
# GenAI Event Names (OTel Semconv v1.29+)
GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS = "gen_ai.client.inference.operation.details"

# GenAI Content Attributes (OTel Semconv v1.29+)
GEN_AI_INPUT_MESSAGES = "gen_ai.input.messages"
GEN_AI_OUTPUT_MESSAGES = "gen_ai.output.messages"
GEN_AI_SYSTEM_INSTRUCTIONS = "gen_ai.system_instructions"
GEN_AI_TOOL_DEFINITIONS = "gen_ai.tool.definitions"
```

#### Phase 2: Create Message Builder Helpers

**File:** `src/openlit/instrumentation/<provider>/utils.py`

**Helper 1: Build Input Messages**
```python
def build_input_messages(messages):
    """
    Convert provider-specific messages to OTel input message structure.

    Returns:
        List of ChatMessage objects with structure:
        [
            {
                "role": "user|assistant|system|tool",
                "parts": [
                    {"type": "text", "content": "..."},
                    {"type": "uri", "modality": "image", "uri": "..."},
                    {"type": "tool_call_response", "id": "...", "response": "..."}
                ]
            }
        ]
    """
    structured_messages = []

    for msg in messages:
        # Extract role
        role = msg.get("role", "user")

        # Build parts array
        parts = []
        content = msg.get("content", "")

        if isinstance(content, str):
            # Simple text content
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            # Multi-part content (text, images, etc.)
            for part in content:
                if part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", {}).get("url", "")
                    # Skip data URIs for privacy
                    if not image_url.startswith("data:"):
                        parts.append({
                            "type": "uri",
                            "modality": "image",
                            "uri": image_url
                        })

        # Handle tool calls (for assistant messages)
        if "tool_calls" in msg:
            for tool_call in msg.get("tool_calls", []):
                parts.append({
                    "type": "tool_call",
                    "id": tool_call.get("id", ""),
                    "name": tool_call.get("function", {}).get("name", ""),
                    "arguments": tool_call.get("function", {}).get("arguments", {})
                })

        # Handle tool responses (for tool role)
        if role == "tool" and "tool_call_id" in msg:
            parts.append({
                "type": "tool_call_response",
                "id": msg.get("tool_call_id", ""),
                "response": content
            })

        structured_messages.append({
            "role": role,
            "parts": parts
        })

    return structured_messages
```

**Helper 2: Build Output Messages**
```python
def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert provider response to OTel output message structure.

    Returns:
        List with single OutputMessage:
        [
            {
                "role": "assistant",
                "parts": [
                    {"type": "text", "content": "..."},
                    {"type": "tool_call", "id": "...", "name": "...", "arguments": {...}}
                ],
                "finish_reason": "stop|length|tool_calls|..."
            }
        ]
    """
    parts = []

    # Add text content if present
    if response_text:
        parts.append({"type": "text", "content": response_text})

    # Add tool calls if present
    if tool_calls:
        for tool_call in tool_calls:
            parts.append({
                "type": "tool_call",
                "id": tool_call.get("id", ""),
                "name": tool_call.get("function", {}).get("name", ""),
                "arguments": tool_call.get("function", {}).get("arguments", {})
            })

    # Map provider finish reasons to OTel standard
    finish_reason_map = {
        "stop": "stop",
        "length": "max_tokens",
        "tool_calls": "tool_calls",
        "function_call": "tool_calls",
        "content_filter": "content_filter",
        # Add provider-specific mappings
    }

    otel_finish_reason = finish_reason_map.get(finish_reason, finish_reason)

    return [{
        "role": "assistant",
        "parts": parts,
        "finish_reason": otel_finish_reason
    }]
```

**Helper 3: Build Tool Definitions**
```python
def build_tool_definitions(tools):
    """
    Extract tool/function definitions from request.

    Returns:
        List of tool definition objects or None:
        [
            {
                "type": "function",
                "function": {
                    "name": "...",
                    "description": "...",
                    "parameters": {...}
                }
            }
        ]
    """
    if not tools:
        return None

    # Tools are usually already in correct format
    # Just validate and pass through
    return tools
```

**Helper 4: Emit Inference Event (Centralized)**
```python
def emit_inference_event(
    event_provider,
    operation_name,
    request_model,
    response_model,
    input_messages=None,
    output_messages=None,
    tool_definitions=None,
    server_address=None,
    server_port=None,
    **extra_attrs
):
    """
    Centralized function to emit gen_ai.client.inference.operation.details event.

    Args:
        event_provider: The OTel event provider
        operation_name: Operation type (chat, completion, embedding, etc.)
        request_model: Model specified in request
        response_model: Model returned in response
        input_messages: Structured input messages
        output_messages: Structured output messages
        tool_definitions: Tool/function definitions
        server_address: API server address
        server_port: API server port
        **extra_attrs: Additional attributes (temperature, max_tokens, etc.)
    """
    try:
        if not event_provider:
            return

        from openlit.__helpers import otel_event
        from openlit.semcov import SemanticConvention

        # Build base attributes
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_name,
        }

        # Add model attributes
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model

        # Add server attributes
        if server_address:
            attributes["server.address"] = server_address
        if server_port:
            attributes["server.port"] = server_port

        # Add messages (only if not None/empty)
        if input_messages:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        # Add tool definitions (recommended)
        if tool_definitions:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Map extra attributes to semantic conventions
        attr_mapping = {
            "temperature": SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
            "max_tokens": SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
            "top_p": SemanticConvention.GEN_AI_REQUEST_TOP_P,
            "frequency_penalty": SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
            "presence_penalty": SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
            "stop_sequences": SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
            "seed": SemanticConvention.GEN_AI_REQUEST_SEED,
            "response_id": SemanticConvention.GEN_AI_RESPONSE_ID,
            "finish_reasons": SemanticConvention.GEN_AI_RESPONSE_FINISH_REASONS,
            "choice_count": SemanticConvention.GEN_AI_RESPONSE_CHOICE_COUNT,
            "output_type": SemanticConvention.GEN_AI_RESPONSE_OUTPUT_TYPE,
            "input_tokens": SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
            "output_tokens": SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
        }

        for key, value in extra_attrs.items():
            if value is not None and key in attr_mapping:
                attributes[attr_mapping[key]] = value

        # Create and emit event
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body=""  # Per spec, all data in attributes
        )

        event_provider.emit(event)

    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)
```

#### Phase 3: Update Processing Functions

**File:** `src/openlit/instrumentation/<provider>/utils.py`

**Pattern for common_chat_logic() or equivalent:**

```python
def common_chat_logic(
    # ... existing parameters ...
    event_provider=None,  # NEW PARAMETER
):
    """Process chat/completion responses"""

    # ... existing span attribute logic (KEEP THIS) ...

    # Set legacy span attributes
    span.set_attribute(SemanticConvention.GEN_AI_PROMPT, formatted_messages)
    span.set_attribute(SemanticConvention.GEN_AI_COMPLETION, response_content)

    # REMOVE OLD SPAN EVENTS - Delete these lines:
    # span.add_event(name="gen_ai.content.prompt", attributes={...})
    # span.add_event(name="gen_ai.content.completion", attributes={...})

    # NEW: Emit log event
    if capture_message_content and event_provider:
        try:
            # Build structured messages
            input_msgs = build_input_messages(kwargs.get("messages", []))
            output_msgs = build_output_messages(
                response_text=llm_response,
                finish_reason=finish_reason,
                tool_calls=tool_calls
            )
            tool_defs = build_tool_definitions(kwargs.get("tools"))

            # Emit event with all attributes
            emit_inference_event(
                event_provider=event_provider,
                operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                request_model=request_model,
                response_model=response_model,
                input_messages=input_msgs,
                output_messages=output_msgs,
                tool_definitions=tool_defs,
                server_address=server_address,
                server_port=server_port,
                # Add all available request parameters
                temperature=kwargs.get("temperature"),
                max_tokens=kwargs.get("max_tokens"),
                top_p=kwargs.get("top_p"),
                frequency_penalty=kwargs.get("frequency_penalty"),
                presence_penalty=kwargs.get("presence_penalty"),
                stop_sequences=kwargs.get("stop"),
                seed=kwargs.get("seed"),
                # Add all available response attributes
                response_id=response_id,
                finish_reasons=[finish_reason],
                choice_count=len(choices),
                output_type=kwargs.get("response_format", {}).get("type"),
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
            )
        except Exception as e:
            logger.warning("Failed to emit event: %s", e)
```

#### Phase 4: Update Wrapper Functions

**File:** `src/openlit/instrumentation/<provider>/<provider>.py` (sync)

**Pattern for chat_completions wrapper:**

```python
def chat_completions(
    # ... existing parameters ...
    event_provider=None,  # NEW PARAMETER
):
    """Wrapper for chat completions"""

    def wrapper(wrapped, instance, args, kwargs):
        # ... existing setup ...

        # For streaming responses
        class TracedSyncStream:
            def __init__(self, wrapped, span, span_name, kwargs,
                        server_address, server_port, event_provider=None):  # NEW
                self._wrapped = wrapped
                self._span = span
                self._event_provider = event_provider  # STORE IT
                # ... rest of init ...

            def __next__(self):
                try:
                    chunk = next(self._wrapped)
                    # ... accumulate chunks ...
                    return chunk
                except StopIteration:
                    # Process complete stream
                    process_streaming_chat_response(
                        # ... existing parameters ...
                        event_provider=self._event_provider,  # PASS IT
                    )
                    raise

        # Execute wrapped function
        response = wrapped(*args, **kwargs)

        # Handle streaming
        if isinstance(response, Stream):
            return TracedSyncStream(
                response, span, span_name, kwargs,
                server_address, server_port,
                event_provider=event_provider  # PASS IT
            )

        # Handle non-streaming
        process_chat_response(
            # ... existing parameters ...
            event_provider=event_provider,  # PASS IT
        )

        return response

    return wrapper
```

**File:** `src/openlit/instrumentation/<provider>/async_<provider>.py` (async)

**Mirror the sync pattern for async:**

```python
def async_chat_completions(
    # ... existing parameters ...
    event_provider=None,  # NEW PARAMETER
):
    """Async wrapper for chat completions"""

    async def wrapper(wrapped, instance, args, kwargs):
        # ... same pattern as sync ...

        class TracedAsyncStream:
            def __init__(self, wrapped, span, span_name, kwargs,
                        server_address, server_port, event_provider=None):  # NEW
                self._event_provider = event_provider  # STORE IT
                # ... rest of init ...

            async def __anext__(self):
                try:
                    chunk = await self._wrapped.__anext__()
                    # ... accumulate chunks ...
                    return chunk
                except StopAsyncIteration:
                    # Process complete stream
                    process_streaming_chat_response(
                        # ... existing parameters ...
                        event_provider=self._event_provider,  # PASS IT
                    )
                    raise

        # ... rest follows sync pattern ...

    return wrapper
```

#### Phase 5: Update Instrumentation Entry Point

**File:** `src/openlit/instrumentation/<provider>/__init__.py`

```python
def _instrument(self, **kwargs):
    """Instrument the provider"""

    # Extract event_provider from kwargs
    event_provider = kwargs.get("event_provider")  # NEW

    # Wrap all operations
    wrap_function_wrapper(
        "provider_sdk.module",
        "ChatCompletions.create",
        chat_completions(
            # ... existing parameters ...
            event_provider=event_provider,  # PASS TO WRAPPER
        ),
    )

    wrap_function_wrapper(
        "provider_sdk.module",
        "AsyncChatCompletions.create",
        async_chat_completions(
            # ... existing parameters ...
            event_provider=event_provider,  # PASS TO WRAPPER
        ),
    )

    # Repeat for all operations:
    # - embeddings (sync + async)
    # - image generation (sync + async)
    # - audio/speech (sync + async)
    # - etc.
```

---

## Code Examples

### Example 1: Complete Chat Message Structure

```python
# Input messages with various content types
input_messages = [
    {
        "role": "system",
        "parts": [
            {"type": "text", "content": "You are a helpful assistant"}
        ]
    },
    {
        "role": "user",
        "parts": [
            {"type": "text", "content": "What's in this image?"},
            {"type": "uri", "modality": "image", "uri": "https://example.com/image.jpg"}
        ]
    },
    {
        "role": "assistant",
        "parts": [
            {"type": "text", "content": "Let me analyze it"},
            {
                "type": "tool_call",
                "id": "call_123",
                "name": "analyze_image",
                "arguments": {"image_url": "..."}
            }
        ]
    },
    {
        "role": "tool",
        "parts": [
            {
                "type": "tool_call_response",
                "id": "call_123",
                "response": "The image contains a cat"
            }
        ]
    }
]

# Output messages
output_messages = [
    {
        "role": "assistant",
        "parts": [
            {"type": "text", "content": "Based on the analysis, the image shows a cat."}
        ],
        "finish_reason": "stop"
    }
]
```

### Example 2: Tool Definitions

```python
tool_definitions = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City name"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"]
                    }
                },
                "required": ["location"]
            }
        }
    }
]
```

### Example 3: Complete Event Emission

```python
emit_inference_event(
    event_provider=event_provider,
    operation_name="chat",
    request_model="gpt-4",
    response_model="gpt-4-0613",
    input_messages=input_messages,
    output_messages=output_messages,
    tool_definitions=tool_definitions,
    server_address="api.openai.com",
    server_port=443,
    temperature=0.7,
    max_tokens=1000,
    top_p=0.9,
    response_id="chatcmpl-123",
    finish_reasons=["stop"],
    choice_count=1,
    input_tokens=50,
    output_tokens=25
)
```

---

## Testing Checklist

### Pre-Migration Testing
- [ ] Identify all `span.add_event()` calls in provider code
- [ ] Document current message formats used by provider
- [ ] Verify existing span attributes are set correctly
- [ ] Run existing test suite - record baseline

### Post-Migration Testing

#### Functional Tests
- [ ] Non-streaming chat/completions with text only
- [ ] Non-streaming with images (if supported)
- [ ] Non-streaming with tool calls
- [ ] Streaming chat/completions
- [ ] Streaming with tool calls
- [ ] Embeddings operations
- [ ] Image generation operations
- [ ] Audio/speech operations

#### Event Validation
- [ ] Event name is `gen_ai.client.inference.operation.details`
- [ ] Input messages in structured format (NOT JSON strings)
- [ ] Output messages in structured format (NOT JSON strings)
- [ ] Messages follow OTel JSON schemas
- [ ] Tool definitions included when tools used
- [ ] All required attributes present
- [ ] All recommended attributes present (when available)
- [ ] Optional attributes included (when available)

#### Backward Compatibility
- [ ] Existing span attributes still set correctly
- [ ] Legacy `gen_ai.prompt` still present
- [ ] Legacy `gen_ai.completion` still present
- [ ] Metrics still recorded
- [ ] No span events present (removed)
- [ ] capture_message_content flag respected
- [ ] event_provider=None works (no events emitted)

#### Error Handling
- [ ] Event emission failure doesn't break instrumentation
- [ ] Malformed messages handled gracefully
- [ ] Missing fields don't cause crashes
- [ ] Non-serializable objects handled

#### Performance
- [ ] No significant latency increase
- [ ] No memory leaks with streaming
- [ ] Event size reasonable (not sending base64 images)

---

## Provider-Specific Notes

### Common Provider Variations

#### Message Format Differences

**OpenAI/Azure OpenAI:**
```python
messages = [
    {"role": "user", "content": "text"},
    {"role": "user", "content": [{"type": "text", "text": "..."}, {"type": "image_url", "image_url": {"url": "..."}}]}
]
```

**Anthropic:**
```python
messages = [
    {"role": "user", "content": "text"},
    {"role": "user", "content": [{"type": "text", "text": "..."}, {"type": "image", "source": {"type": "url", "url": "..."}}]}
]
```

**Google (Gemini):**
```python
contents = [
    {"role": "user", "parts": [{"text": "..."}]},
    {"role": "user", "parts": [{"text": "..."}, {"inline_data": {"mime_type": "...", "data": "..."}}]}
]
```

**Cohere:**
```python
message = "text"  # Simple string
chat_history = [{"role": "USER", "message": "..."}, {"role": "CHATBOT", "message": "..."}]
```

#### Tool/Function Call Variations

**OpenAI:** `tools` with `function` type
**Anthropic:** `tools` with `function` type (similar)
**Google:** `tools` with `function_declarations`
**Cohere:** `tools` with separate format

**Solution:** Normalize to OTel format in `build_tool_definitions()`

#### Finish Reason Mapping

Each provider has different finish reason names. Create a mapping:

```python
FINISH_REASON_MAP = {
    # OpenAI
    "stop": "stop",
    "length": "max_tokens",
    "tool_calls": "tool_calls",
    "content_filter": "content_filter",

    # Anthropic
    "end_turn": "stop",
    "max_tokens": "max_tokens",
    "stop_sequence": "stop",

    # Google
    "STOP": "stop",
    "MAX_TOKENS": "max_tokens",
    "SAFETY": "content_filter",

    # Cohere
    "COMPLETE": "stop",
    "MAX_TOKENS": "max_tokens",

    # Add provider-specific mappings
}
```

### Provider Migration Priority

**High Priority (Similar to OpenAI):**
1. Azure OpenAI - Nearly identical API
2. Anthropic - Very similar structure
3. Google Gemini - Similar concepts, different naming

**Medium Priority:**
4. Cohere - Different API structure
5. Mistral - Similar to OpenAI
6. Groq - Similar to OpenAI

**Lower Priority:**
7. HuggingFace - Varies by model
8. Bedrock - Varies by provider

### Common Pitfalls

#### 1. Don't JSON Stringify Messages
```python
# ❌ WRONG
attributes = {
    "gen_ai.input.messages": json.dumps(messages)
}

# ✅ CORRECT
attributes = {
    "gen_ai.input.messages": messages  # Direct structured object
}
```

#### 2. Don't Skip capture_message_content Check
```python
# ❌ WRONG - Always emits
emit_inference_event(event_provider, ...)

# ✅ CORRECT - Check flag first
if capture_message_content and event_provider:
    emit_inference_event(event_provider, ...)
```

#### 3. Don't Break on Missing event_provider
```python
# ❌ WRONG - Will crash if None
event_provider.emit(event)

# ✅ CORRECT - Check first
if event_provider:
    event_provider.emit(event)
```

#### 4. Don't Include Sensitive Data
```python
# ❌ WRONG - Includes base64 image data
if image_url:
    parts.append({"type": "uri", "uri": image_url})

# ✅ CORRECT - Skip data URIs
if image_url and not image_url.startswith("data:"):
    parts.append({"type": "uri", "modality": "image", "uri": image_url})
```

#### 5. Don't Remove Existing Span Attributes
```python
# ❌ WRONG - Removes legacy attributes
# span.set_attribute("gen_ai.prompt", messages)  # Commented out

# ✅ CORRECT - Keep them for backward compatibility
span.set_attribute("gen_ai.prompt", messages)  # Keep this
# Add new events separately
if event_provider:
    emit_inference_event(...)
```

---

## Evaluation Events Pattern

For evaluation systems (hallucination, bias, toxicity detection):

### Event Name
`gen_ai.evaluation.result`

### Implementation Pattern

```python
# 1. Add semantic conventions
GEN_AI_EVALUATION_RESULT = "gen_ai.evaluation.result"
GEN_AI_EVALUATION_NAME = "gen_ai.evaluation.name"
GEN_AI_EVALUATION_SCORE_VALUE = "gen_ai.evaluation.score.value"
GEN_AI_EVALUATION_SCORE_LABEL = "gen_ai.evaluation.score.label"
GEN_AI_EVALUATION_EXPLANATION = "gen_ai.evaluation.explanation"

# 2. Create helper
def emit_evaluation_event(
    event_provider,
    evaluation_name,
    score_value,
    score_label,
    explanation,
    response_id=None
):
    if not event_provider:
        return

    attributes = {
        SemanticConvention.GEN_AI_EVALUATION_NAME: evaluation_name,
        SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: float(score_value),
        SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: score_label,
    }

    if explanation:
        attributes[SemanticConvention.GEN_AI_EVALUATION_EXPLANATION] = explanation
    if response_id:
        attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = response_id

    event = otel_event(
        name=SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes=attributes,
        body=""
    )

    event_provider.emit(event)

# 3. Update evaluator classes
class HallucinationDetector:
    def __init__(self, ..., event_provider=None):
        self.event_provider = event_provider

    def measure(self, ...):
        result = run_evaluation(...)

        # Existing counter metric
        if self.collect_metrics:
            metric_counter.add(1, attributes)

        # New event emission
        if self.event_provider:
            emit_evaluation_event(
                event_provider=self.event_provider,
                evaluation_name="hallucination",
                score_value=result.score,
                score_label=result.verdict,
                explanation=result.explanation
            )

        return result
```

---

## Reference Links

- [OTel Gen-AI Events Spec](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md)
- [OTel Input Messages Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-input-messages.json)
- [OTel Output Messages Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-output-messages.json)
- [OpenAI Implementation (Reference)](sdk/python/src/openlit/instrumentation/openai/)

---

## Migration Checklist Template

Use this checklist when migrating a new provider:

### Planning
- [ ] Read this guide completely
- [ ] Review provider's API documentation
- [ ] Identify all operations to migrate (chat, embeddings, etc.)
- [ ] Map provider message format to OTel structure
- [ ] Map provider parameters to OTel attributes
- [ ] Map provider finish reasons to OTel values

### Implementation
- [ ] Add semantic conventions to `semcov/__init__.py`
- [ ] Create `build_input_messages()` for provider
- [ ] Create `build_output_messages()` for provider
- [ ] Create `build_tool_definitions()` for provider
- [ ] Create `emit_inference_event()` (can reuse pattern)
- [ ] Update all processing functions with event_provider
- [ ] Update all sync wrapper functions
- [ ] Update all async wrapper functions
- [ ] Update instrumentation entry point
- [ ] Remove all `span.add_event()` calls

### Testing
- [ ] Run all tests from Testing Checklist above
- [ ] Verify events in OTel collector/console
- [ ] Validate message structures against JSON schemas
- [ ] Test with real provider API
- [ ] Load test with streaming operations

### Documentation
- [ ] Update provider README with event support
- [ ] Add examples showing event usage
- [ ] Document any provider-specific quirks
- [ ] Update changelog

---

## Questions?

If you encounter issues not covered in this guide:

1. Check the OpenAI reference implementation
2. Review the OTel Gen-AI spec
3. Look at `events.py` for event provider setup
4. Check `__helpers.py` for `otel_event()` helper

---

**Last Updated:** 2026-02-12
**Reference Implementation:** OpenAI instrumentation (Phases 1-6 complete)
**Status:** Production-ready ✅
