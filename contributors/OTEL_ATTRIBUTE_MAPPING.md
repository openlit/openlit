# OTel Gen-AI Attribute Mapping Reference

Quick reference for mapping provider-specific parameters to OpenTelemetry Gen-AI semantic convention attributes.

---

## Event Names

| Purpose | OTel Event Name |
|---------|----------------|
| Inference operations (chat, completion, embedding, etc.) | `gen_ai.client.inference.operation.details` |
| Evaluation results (hallucination, bias, toxicity) | `gen_ai.evaluation.result` |

---

## Required Attributes (Inference)

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.operation.name` | `GEN_AI_OPERATION_NAME` | string | **REQUIRED** - Name of the operation being performed | `"chat"`, `"completion"`, `"embedding"` |

---

## Conditionally Required Attributes (Inference)

These attributes MUST be included when the specified condition is met:

| OTel Attribute | Constant | Type | Condition | Description | Example |
|----------------|----------|------|-----------|-------------|---------|
| `error.type` | `ERROR_TYPE` | string | If operation ended in error | Error class/type describing the error | `"timeout"`, `"rate_limit"` |
| `gen_ai.conversation.id` | `GEN_AI_CONVERSATION_ID` | string | When readily available | Identifies the conversation/session | `"session-abc123"` |
| `gen_ai.output.type` | `GEN_AI_OUTPUT_TYPE` | string | When applicable | Requested content type | `"text"`, `"json_object"` |
| `gen_ai.request.choice.count` | `GEN_AI_REQUEST_CHOICE_COUNT` | int | If available and ≠ 1 | Number of choices requested | `3` |
| `gen_ai.request.model` | `GEN_AI_REQUEST_MODEL` | string | If available | Model name being called | `"gpt-4"`, `"claude-3-opus"` |
| `gen_ai.request.seed` | `GEN_AI_REQUEST_SEED` | int | If seed was provided | Seed for deterministic generation | `42` |
| `server.port` | `SERVER_PORT` | int | If server.address is set | Server port number | `443` |

---

## Recommended Attributes (Inference)

These attributes SHOULD be included when available:

### Request Parameters

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.request.frequency_penalty` | `GEN_AI_REQUEST_FREQUENCY_PENALTY` | double | Frequency penalty setting | `0.5` |
| `gen_ai.request.max_tokens` | `GEN_AI_REQUEST_MAX_TOKENS` | int | Maximum tokens to generate | `1024` |
| `gen_ai.request.presence_penalty` | `GEN_AI_REQUEST_PRESENCE_PENALTY` | double | Presence penalty setting | `0.3` |
| `gen_ai.request.stop_sequences` | `GEN_AI_REQUEST_STOP_SEQUENCES` | string[] | Sequences where model stops | `["END", "\n\n"]` |
| `gen_ai.request.temperature` | `GEN_AI_REQUEST_TEMPERATURE` | double | Temperature setting | `0.7` |
| `gen_ai.request.top_p` | `GEN_AI_REQUEST_TOP_P` | double | Top-p (nucleus) sampling | `0.9` |

### Response Metadata

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.response.finish_reasons` | `GEN_AI_RESPONSE_FINISH_REASONS` | string[] | Reasons model stopped | `["stop"]`, `["max_tokens"]` |
| `gen_ai.response.id` | `GEN_AI_RESPONSE_ID` | string | Unique response identifier | `"chatcmpl-123"` |
| `gen_ai.response.model` | `GEN_AI_RESPONSE_MODEL` | string | Model that generated response | `"gpt-4-0613"` |

### Usage Metrics

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.usage.cache_creation.input_tokens` | `GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS` | int | Input tokens written to cache | `512` |
| `gen_ai.usage.cache_read.input_tokens` | `GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS` | int | Input tokens served from cache | `256` |
| `gen_ai.usage.input_tokens` | `GEN_AI_USAGE_INPUT_TOKENS` | int | Total tokens in prompt | `128` |
| `gen_ai.usage.output_tokens` | `GEN_AI_USAGE_OUTPUT_TOKENS` | int | Tokens in response | `64` |

### Server Information

| OTel Attribute | Type | Description | Example |
|----------------|------|-------------|---------|
| `server.address` | string | GenAI server hostname/IP | `"api.openai.com"`, `"api.anthropic.com"` |

---

## Opt-In Attributes (Content - Chat/Completions)

These attributes contain sensitive content and MUST only be included when explicitly enabled via `capture_message_content=True`:

| OTel Attribute | Constant | Type | Description | Format |
|----------------|----------|------|-------------|--------|
| `gen_ai.input.messages` | `GEN_AI_INPUT_MESSAGES` | array | Chat history provided to model as input | See [Input Message Schema](#input-message-schema) |
| `gen_ai.output.messages` | `GEN_AI_OUTPUT_MESSAGES` | array | Messages returned by model (responses) | See [Output Message Schema](#output-message-schema) |
| `gen_ai.system_instructions` | `GEN_AI_SYSTEM_INSTRUCTIONS` | string or array | System message/instructions separate from chat | `"You are a helpful assistant"` |
| `gen_ai.tool.definitions` | `GEN_AI_TOOL_DEFINITIONS` | array | List of tool/function definitions available | See [Tool Definition Schema](#tool-definition-schema) |

**Important:** These attributes contain user data and MUST only be set when `capture_message_content=True`.

---

## Evaluation Event Attributes

### Event: `gen_ai.evaluation.result`

#### Required Attributes

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.evaluation.name` | `GEN_AI_EVALUATION_NAME` | string | **REQUIRED** - Evaluation metric name used | `"hallucination"`, `"bias_detection"`, `"toxicity"` |

#### Conditionally Required Attributes

| OTel Attribute | Constant | Type | Condition | Description | Example |
|----------------|----------|------|-----------|-------------|---------|
| `error.type` | `ERROR_TYPE` | string | If operation ended in error | Error type for failed evaluation | `"api_error"` |
| `gen_ai.evaluation.score.label` | `GEN_AI_EVALUATION_SCORE_LABEL` | string | At least one of label/value required | Human-readable evaluation label | `"yes"`, `"no"`, `"pass"`, `"fail"` |
| `gen_ai.evaluation.score.value` | `GEN_AI_EVALUATION_SCORE_VALUE` | double | At least one of label/value required | Numeric evaluation score | `0.85` |

**Note:** Either `score.label` or `score.value` (or both) MUST be present for the evaluation to be meaningful.

#### Recommended Attributes

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.evaluation.explanation` | `GEN_AI_EVALUATION_EXPLANATION` | string | Free-form explanation for assigned score | `"The output contains factual inaccuracies"` |
| `gen_ai.response.id` | `GEN_AI_RESPONSE_ID` | string | Links evaluation to specific GenAI response | `"chatcmpl-123"` |

---

## Attribute Requirement Levels

Understanding when to include attributes is critical for OTel compliance:

### Required
- **MUST** be included in every event
- Missing required attributes makes the event non-compliant
- Example: `gen_ai.operation.name`

### Conditionally Required
- **MUST** be included when the specified condition is met
- The condition describes when the attribute becomes mandatory
- Examples:
  - `error.type` - Required IF the operation ended in error
  - `server.port` - Required IF `server.address` is set
  - `gen_ai.request.seed` - Required IF a seed was provided in the request

### Recommended
- **SHOULD** be included when the information is available
- Improves observability but not strictly required
- Examples: `gen_ai.response.id`, `gen_ai.usage.input_tokens`

### Opt-In
- **MUST NOT** be included by default (contains sensitive data)
- Only include when user explicitly enables via configuration flag
- Examples: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.definitions`
- Check: `if capture_message_content and event_provider:`

### Implementation Guidelines

```python
# Required - always include
attributes = {
    "gen_ai.operation.name": "chat",  # REQUIRED
}

# Conditionally Required - check condition first
if error_occurred:
    attributes["error.type"] = error_type  # REQUIRED when condition met

if server_address:
    attributes["server.address"] = server_address
    attributes["server.port"] = server_port  # REQUIRED when server.address set

if seed is not None:
    attributes["gen_ai.request.seed"] = seed  # REQUIRED when provided

# Recommended - include when available
if response_id:
    attributes["gen_ai.response.id"] = response_id  # RECOMMENDED

if input_tokens is not None:
    attributes["gen_ai.usage.input_tokens"] = input_tokens  # RECOMMENDED

# Opt-In - only when explicitly enabled
if capture_message_content and event_provider:
    attributes["gen_ai.input.messages"] = input_messages  # OPT-IN
    attributes["gen_ai.output.messages"] = output_messages  # OPT-IN
```

---

## Input Message Schema

### Structure
```json
[
  {
    "role": "user|assistant|system|tool",
    "parts": [
      {"type": "text", "content": "..."},
      {"type": "uri", "modality": "image|audio|video", "uri": "https://..."},
      {"type": "tool_call", "id": "...", "name": "...", "arguments": {...}},
      {"type": "tool_call_response", "id": "...", "response": "..."}
    ]
  }
]
```

### Part Types

#### Text Part
```json
{
  "type": "text",
  "content": "What is the weather?"
}
```

#### URI Part (Image/Audio/Video)
```json
{
  "type": "uri",
  "modality": "image",
  "uri": "https://example.com/image.jpg"
}
```

**Important:** Never include data URIs (`data:image/png;base64,...`). Only HTTP/HTTPS URLs.

#### Tool Call Part (in assistant messages)
```json
{
  "type": "tool_call",
  "id": "call_123",
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco",
    "unit": "celsius"
  }
}
```

#### Tool Call Response Part (in tool messages)
```json
{
  "type": "tool_call_response",
  "id": "call_123",
  "response": "The weather is 20°C and sunny"
}
```

### Example: Complete Input Messages

```python
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
            {"type": "uri", "modality": "image", "uri": "https://example.com/photo.jpg"}
        ]
    },
    {
        "role": "assistant",
        "parts": [
            {"type": "text", "content": "Let me analyze it."},
            {
                "type": "tool_call",
                "id": "call_abc123",
                "name": "analyze_image",
                "arguments": {"image_url": "https://example.com/photo.jpg"}
            }
        ]
    },
    {
        "role": "tool",
        "parts": [
            {
                "type": "tool_call_response",
                "id": "call_abc123",
                "response": "The image shows a cat sitting on a couch"
            }
        ]
    },
    {
        "role": "user",
        "parts": [
            {"type": "text", "content": "What breed is it?"}
        ]
    }
]
```

---

## Output Message Schema

### Structure
```json
[
  {
    "role": "assistant",
    "parts": [
      {"type": "text", "content": "..."},
      {"type": "tool_call", "id": "...", "name": "...", "arguments": {...}}
    ],
    "finish_reason": "stop|max_tokens|tool_calls|content_filter|..."
  }
]
```

**Note:** Output messages array typically contains only ONE message (the assistant's response for choice 0).

### Finish Reasons

Map provider-specific finish reasons to OTel standard values:

| Provider | Provider Value | OTel Value |
|----------|---------------|------------|
| OpenAI | `"stop"` | `"stop"` |
| OpenAI | `"length"` | `"max_tokens"` |
| OpenAI | `"tool_calls"` | `"tool_calls"` |
| OpenAI | `"content_filter"` | `"content_filter"` |
| Anthropic | `"end_turn"` | `"stop"` |
| Anthropic | `"max_tokens"` | `"max_tokens"` |
| Anthropic | `"stop_sequence"` | `"stop"` |
| Google | `"STOP"` | `"stop"` |
| Google | `"MAX_TOKENS"` | `"max_tokens"` |
| Google | `"SAFETY"` | `"content_filter"` |
| Cohere | `"COMPLETE"` | `"stop"` |
| Cohere | `"MAX_TOKENS"` | `"max_tokens"` |

### Example: Output Message

```python
output_messages = [
    {
        "role": "assistant",
        "parts": [
            {"type": "text", "content": "Based on the image analysis, it appears to be a British Shorthair cat."}
        ],
        "finish_reason": "stop"
    }
]
```

### Example: Output with Tool Call

```python
output_messages = [
    {
        "role": "assistant",
        "parts": [
            {"type": "text", "content": "I'll check the weather for you."},
            {
                "type": "tool_call",
                "id": "call_xyz789",
                "name": "get_weather",
                "arguments": {
                    "location": "San Francisco",
                    "unit": "celsius"
                }
            }
        ],
        "finish_reason": "tool_calls"
    }
]
```

---

## Tool Definition Schema

### Structure
```json
[
  {
    "type": "function",
    "function": {
      "name": "function_name",
      "description": "What the function does",
      "parameters": {
        "type": "object",
        "properties": {
          "param_name": {
            "type": "string|number|boolean|object|array",
            "description": "Parameter description",
            "enum": ["optional", "list", "of", "values"]
          }
        },
        "required": ["param_name"]
      }
    }
  }
]
```

### Example: Weather Function

```python
tool_definitions = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city name, e.g., 'San Francisco'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit"
                    }
                },
                "required": ["location"]
            }
        }
    }
]
```

---

## Provider Parameter Mapping

### OpenAI / Azure OpenAI

Request mapping:
| OpenAI Parameter | OTel Attribute | Required Level | Notes |
|------------------|----------------|----------------|-------|
| `messages` | `gen_ai.input.messages` | Opt-In | Transform to structured format |
| `model` | `gen_ai.request.model` | Conditionally Required | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Recommended | Direct mapping |
| `max_tokens` / `max_completion_tokens` | `gen_ai.request.max_tokens` | Recommended | Direct mapping |
| `top_p` | `gen_ai.request.top_p` | Recommended | Direct mapping |
| `frequency_penalty` | `gen_ai.request.frequency_penalty` | Recommended | Direct mapping |
| `presence_penalty` | `gen_ai.request.presence_penalty` | Recommended | Direct mapping |
| `stop` | `gen_ai.request.stop_sequences` | Recommended | Direct mapping |
| `seed` | `gen_ai.request.seed` | Conditionally Required | Include if provided |
| `n` | `gen_ai.request.choice.count` | Conditionally Required | Include if ≠ 1 |
| `tools` / `functions` | `gen_ai.tool.definitions` | Opt-In | Direct mapping |
| `response_format.type` | `gen_ai.output.type` | Conditionally Required | When applicable |

Response mapping:
| OpenAI Field | OTel Attribute | Required Level | Notes |
|--------------|----------------|----------------|-------|
| `id` | `gen_ai.response.id` | Recommended | Direct mapping |
| `model` | `gen_ai.response.model` | Recommended | Direct mapping |
| `choices[0].message.content` | Part of `gen_ai.output.messages` | Opt-In | Text content |
| `choices[0].message.tool_calls` | Part of `gen_ai.output.messages` | Opt-In | Tool calls |
| `choices[0].finish_reason` | Part of `gen_ai.output.messages[0].finish_reason` | Recommended | Map: length→max_tokens |
| `usage.prompt_tokens` | `gen_ai.usage.input_tokens` | Recommended | Direct mapping |
| `usage.completion_tokens` | `gen_ai.usage.output_tokens` | Recommended | Direct mapping |
| `usage.prompt_tokens_details.cached_tokens` | `gen_ai.usage.cache_read.input_tokens` | Recommended | Cached input tokens |
| `system_fingerprint` | Custom attribute | Optional | OpenAI-specific backend configuration identifier |

### Anthropic

Request mapping:
| Anthropic Parameter | OTel Attribute | Required Level | Notes |
|---------------------|----------------|----------------|-------|
| `messages` | `gen_ai.input.messages` | Opt-In | Transform to structured format |
| `system` | `gen_ai.system_instructions` | Opt-In | Single string (not in messages array) |
| `model` | `gen_ai.request.model` | Conditionally Required | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Recommended | Direct mapping |
| `max_tokens` | `gen_ai.request.max_tokens` | Recommended | Direct mapping |
| `top_p` | `gen_ai.request.top_p` | Recommended | Direct mapping |
| `top_k` | `gen_ai.request.top_k` | Recommended | Direct mapping (Anthropic-specific) |
| `stop_sequences` | `gen_ai.request.stop_sequences` | Recommended | Direct mapping |
| `tools` | `gen_ai.tool.definitions` | Opt-In | Transform if needed |

Response mapping:
| Anthropic Field | OTel Attribute | Required Level |
|-----------------|----------------|----------------|
| `id` | `gen_ai.response.id` | Recommended |
| `model` | `gen_ai.response.model` | Recommended |
| `content[0].text` | Part of `gen_ai.output.messages` | Opt-In |
| `content[*].type="tool_use"` | Part of `gen_ai.output.messages` | Opt-In |
| `stop_reason` | Map to `gen_ai.output.messages[0].finish_reason` | Recommended |
| `usage.input_tokens` | `gen_ai.usage.input_tokens` | Recommended |
| `usage.output_tokens` | `gen_ai.usage.output_tokens` | Recommended |
| `usage.cache_creation_input_tokens` | `gen_ai.usage.cache_creation.input_tokens` | Recommended |
| `usage.cache_read_input_tokens` | `gen_ai.usage.cache_read.input_tokens` | Recommended |

### Google (Gemini)

Request mapping:
| Google Parameter | OTel Attribute | Required Level | Notes |
|------------------|----------------|----------------|-------|
| `contents` | `gen_ai.input.messages` | Opt-In | Already uses "parts" structure, map role "model"→"assistant" |
| `systemInstruction` | `gen_ai.system_instructions` | Opt-In | Direct mapping |
| `model` | `gen_ai.request.model` | Conditionally Required | Extract from full name (e.g., "models/gemini-pro" → "gemini-pro") |
| `generationConfig.temperature` | `gen_ai.request.temperature` | Recommended | Direct mapping |
| `generationConfig.maxOutputTokens` | `gen_ai.request.max_tokens` | Recommended | Direct mapping |
| `generationConfig.topP` | `gen_ai.request.top_p` | Recommended | Direct mapping |
| `generationConfig.topK` | `gen_ai.request.top_k` | Recommended | Direct mapping |
| `generationConfig.stopSequences` | `gen_ai.request.stop_sequences` | Recommended | Direct mapping |
| `generationConfig.seed` | `gen_ai.request.seed` | Conditionally Required | Include if provided |
| `tools` | `gen_ai.tool.definitions` | Opt-In | Transform `function_declarations` |

Response mapping:
| Google Field | OTel Attribute | Required Level | Notes |
|--------------|----------------|----------------|-------|
| N/A | `gen_ai.response.id` | Recommended | Google doesn't provide response IDs - set to None |
| Extracted from request | `gen_ai.response.model` | Recommended | Use request model |
| `candidates[0].content.parts[0].text` | Part of `gen_ai.output.messages` | Opt-In | Text content |
| `candidates[0].content.parts[*].functionCall` | Part of `gen_ai.output.messages` | Opt-In | Tool calls (no IDs provided) |
| `candidates[0].finishReason` | Map to `gen_ai.output.messages[0].finish_reason` | Recommended | Map: STOP→stop, MAX_TOKENS→max_tokens, SAFETY→content_filter |
| `usageMetadata.promptTokenCount` | `gen_ai.usage.input_tokens` | Recommended | Direct mapping |
| `usageMetadata.candidatesTokenCount` | `gen_ai.usage.output_tokens` | Recommended | Direct mapping |
| `usageMetadata.cachedContentTokenCount` | `gen_ai.usage.cache_read.input_tokens` | Recommended | Cached input tokens |
| `usageMetadata.thoughtsTokenCount` | Custom attribute | Recommended | Google-specific reasoning tokens (not in OTel spec yet) |

### Cohere

Request mapping:
| Cohere Parameter | OTel Attribute | Required Level | Notes |
|------------------|----------------|----------------|-------|
| `message` | `gen_ai.input.messages` | Opt-In | Transform to array with user role |
| `chat_history` | `gen_ai.input.messages` | Opt-In | Combine with message |
| `preamble` | `gen_ai.system_instructions` | Opt-In | Direct mapping |
| `model` | `gen_ai.request.model` | Conditionally Required | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Recommended | Direct mapping |
| `max_tokens` | `gen_ai.request.max_tokens` | Recommended | Direct mapping |
| `p` | `gen_ai.request.top_p` | Recommended | Direct mapping (Cohere uses 'p' instead of 'top_p') |
| `k` | `gen_ai.request.top_k` | Recommended | Direct mapping (Cohere uses 'k' instead of 'top_k') |
| `stop_sequences` | `gen_ai.request.stop_sequences` | Recommended | Direct mapping |
| `seed` | `gen_ai.request.seed` | Conditionally Required | Include if provided |
| `tools` | `gen_ai.tool.definitions` | Opt-In | Transform format |

Response mapping:
| Cohere Field | OTel Attribute | Required Level | Notes |
|--------------|----------------|----------------|-------|
| `generation_id` | `gen_ai.response.id` | Recommended | Direct mapping |
| From request | `gen_ai.response.model` | Recommended | Echo request model |
| `text` | Part of `gen_ai.output.messages` | Opt-In | Text content |
| `tool_calls` | Part of `gen_ai.output.messages` | Opt-In | Tool calls |
| `finish_reason` | Map to `gen_ai.output.messages[0].finish_reason` | Recommended | Map: COMPLETE→stop, MAX_TOKENS→max_tokens |
| `meta.tokens.input_tokens` | `gen_ai.usage.input_tokens` | Recommended | Direct mapping |
| `meta.tokens.output_tokens` | `gen_ai.usage.output_tokens` | Recommended | Direct mapping |

---

## Missing Attributes to Add

Based on the OTel Gen-AI semantic conventions, these attributes are currently missing from our implementation and should be added:

### High Priority (Conditionally Required)

| Attribute | Type | Condition | Current Status | Implementation Notes |
|-----------|------|-----------|----------------|---------------------|
| `gen_ai.conversation.id` | string | When readily available | ❌ Not implemented | Add when session/conversation tracking is available |
| `gen_ai.output.type` | string | When applicable | ❌ Not implemented | Extract from `response_format.type` (OpenAI), add to emit_inference_event() |
| `gen_ai.request.choice.count` | int | If available and ≠ 1 | ❌ Not implemented | Extract from `n` parameter (OpenAI), add to emit_inference_event() |
| `error.type` | string | If operation failed | ❌ Not implemented | Capture error class in exception handlers, add to event attributes |

### Medium Priority (Recommended)

| Attribute | Type | Current Status | Implementation Notes |
|-----------|------|----------------|---------------------|
| `gen_ai.request.frequency_penalty` | double | ✅ Partially | Only in OpenAI, add to Anthropic/Google event emission |
| `gen_ai.request.presence_penalty` | double | ✅ Partially | Only in OpenAI, add to event emission |
| `gen_ai.usage.cache_creation.input_tokens` | int | ❌ Not implemented | Anthropic provides this, add to emit_inference_event() |
| `gen_ai.usage.cache_read.input_tokens` | int | ❌ Not implemented | Anthropic & OpenAI provide this, add to emit_inference_event() |

### Implementation Checklist

**For OpenAI:**
- [ ] Add `gen_ai.output.type` from `response_format.type`
- [ ] Add `gen_ai.request.choice.count` from `n` parameter
- [ ] Add `gen_ai.usage.cache_read.input_tokens` from `usage.prompt_tokens_details.cached_tokens`
- [ ] Add `gen_ai.request.frequency_penalty` to event emission
- [ ] Add `gen_ai.request.presence_penalty` to event emission
- [ ] Add error handling with `error.type` attribute

**For Anthropic:**
- [ ] Add `gen_ai.usage.cache_creation.input_tokens` from `usage.cache_creation_input_tokens`
- [ ] Add `gen_ai.usage.cache_read.input_tokens` from `usage.cache_read_input_tokens`
- [ ] Add error handling with `error.type` attribute

**For Google AI Studio:**
- [ ] Add `gen_ai.usage.cache_read.input_tokens` from `usageMetadata.cachedContentTokenCount`
- [ ] Add `gen_ai.request.seed` when provided
- [ ] Add error handling with `error.type` attribute

**All Providers:**
- [ ] Add `gen_ai.conversation.id` extraction when session tracking is available
- [ ] Implement error.type capture in exception handlers
- [ ] Update emit_inference_event() signature to accept new attributes
- [ ] Update SemanticConvention constants for new attributes

---

## Common Patterns

### Pattern 1: Extract Request Attributes

```python
def extract_request_attributes(kwargs):
    """Extract all available request parameters"""
    return {
        "temperature": kwargs.get("temperature"),
        "max_tokens": kwargs.get("max_tokens"),
        "top_p": kwargs.get("top_p"),
        "frequency_penalty": kwargs.get("frequency_penalty"),
        "presence_penalty": kwargs.get("presence_penalty"),
        "stop_sequences": kwargs.get("stop"),
        "seed": kwargs.get("seed"),
    }
```

### Pattern 2: Extract Response Attributes

```python
def extract_response_attributes(response):
    """Extract all available response metadata"""
    return {
        "response_id": response.id,
        "finish_reasons": [choice.finish_reason for choice in response.choices],
        "choice_count": len(response.choices),
        "output_type": response.object,  # or from request
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }
```

### Pattern 3: Combine Attributes for Event

```python
# In processing function
request_attrs = extract_request_attributes(kwargs)
response_attrs = extract_response_attributes(response)

emit_inference_event(
    event_provider=event_provider,
    operation_name=operation_type,
    request_model=request_model,
    response_model=response_model,
    input_messages=input_messages,
    output_messages=output_messages,
    tool_definitions=tool_definitions,
    server_address=server_address,
    server_port=443,
    **request_attrs,
    **response_attrs
)
```

---

## Validation Checklist

When implementing event emission, verify:

### Event Structure
- [ ] Event name is exactly `gen_ai.client.inference.operation.details` (inference) or `gen_ai.evaluation.result` (evaluation)
- [ ] Event body is empty string (all data in attributes per OTel spec)
- [ ] Using OTel EventLoggerProvider (not span events)

### Required Attributes
- [ ] `gen_ai.operation.name` always present (inference events)
- [ ] `gen_ai.evaluation.name` always present (evaluation events)

### Conditionally Required Attributes
- [ ] `error.type` included if operation failed
- [ ] `server.port` included if `server.address` is set
- [ ] `gen_ai.request.seed` included if seed was provided
- [ ] `gen_ai.evaluation.score.label` or `gen_ai.evaluation.score.value` present (at least one)

### Recommended Attributes
- [ ] Request parameters included when available (`temperature`, `max_tokens`, `top_p`, etc.)
- [ ] Response metadata included when available (`response_id`, `finish_reasons`, `response_model`)
- [ ] Usage metrics included when available (`input_tokens`, `output_tokens`, cache tokens)
- [ ] Server information included when known (`server.address`, `server.port`)

### Opt-In Attributes (Content)
- [ ] Content attributes ONLY included when `capture_message_content=True`
- [ ] Input messages are structured objects (not JSON strings)
- [ ] Output messages are structured objects (not JSON strings)
- [ ] No data URIs in image references (only HTTP/HTTPS URLs)
- [ ] Tool definitions included when tools are used
- [ ] System instructions included when present

### Message Format
- [ ] Input messages follow [OTel input schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-input-messages.json)
- [ ] Output messages follow [OTel output schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-output-messages.json)
- [ ] Finish reasons mapped to OTel standard values (not provider-specific)
- [ ] Message parts use correct types: `text`, `uri`, `tool_call`, `tool_call_response`

### Error Handling
- [ ] Event emission wrapped in try/except (never raises)
- [ ] Silent failures with warning logs
- [ ] Instrumentation continues even if event emission fails

---

## References

- [OTel Gen-AI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md)
- [OTel Gen-AI Attributes](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/README.md)
- [Input Messages JSON Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-input-messages.json)
- [Output Messages JSON Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-output-messages.json)

---

## Summary of Requirement Levels

| Level | Symbol | Meaning | Example |
|-------|--------|---------|---------|
| **Required** | 🔴 | MUST be present in every event | `gen_ai.operation.name` |
| **Conditionally Required** | 🟡 | MUST be present when condition met | `error.type` (if error occurred) |
| **Recommended** | 🟢 | SHOULD be present when available | `gen_ai.response.id`, `gen_ai.usage.input_tokens` |
| **Opt-In** | 🔵 | Only when explicitly enabled (sensitive data) | `gen_ai.input.messages`, `gen_ai.output.messages` |

---

**Last Updated:** 2026-02-12 (Expanded with complete OTel attribute requirements)
