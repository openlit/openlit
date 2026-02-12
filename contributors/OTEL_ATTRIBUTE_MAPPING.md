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
| `gen_ai.operation` | `GEN_AI_OPERATION` | string | Type of operation | `"chat"`, `"completion"`, `"embedding"` |
| `gen_ai.request.model` | `GEN_AI_REQUEST_MODEL` | string | Model requested | `"gpt-4"`, `"claude-3-opus"` |
| `gen_ai.response.model` | `GEN_AI_RESPONSE_MODEL` | string | Model that responded | `"gpt-4-0613"` |

---

## Content Attributes (Chat/Completions)

| OTel Attribute | Constant | Type | Description | Format |
|----------------|----------|------|-------------|--------|
| `gen_ai.input.messages` | `GEN_AI_INPUT_MESSAGES` | array | Structured input messages | See [Input Message Schema](#input-message-schema) |
| `gen_ai.output.messages` | `GEN_AI_OUTPUT_MESSAGES` | array | Structured output messages | See [Output Message Schema](#output-message-schema) |
| `gen_ai.system_instructions` | `GEN_AI_SYSTEM_INSTRUCTIONS` | string | System prompt (alternative to messages) | `"You are a helpful assistant"` |
| `gen_ai.tool.definitions` | `GEN_AI_TOOL_DEFINITIONS` | array | Available tool/function definitions | See [Tool Definition Schema](#tool-definition-schema) |

---

## Request Parameters (Optional)

| OTel Attribute | Constant | Type | Provider Parameter | Default |
|----------------|----------|------|-------------------|---------|
| `gen_ai.request.temperature` | `GEN_AI_REQUEST_TEMPERATURE` | double | `temperature` | Provider-specific |
| `gen_ai.request.max_tokens` | `GEN_AI_REQUEST_MAX_TOKENS` | int | `max_tokens`, `max_completion_tokens` | Provider-specific |
| `gen_ai.request.top_p` | `GEN_AI_REQUEST_TOP_P` | double | `top_p` | 1.0 |
| `gen_ai.request.top_k` | `GEN_AI_REQUEST_TOP_K` | int | `top_k` | Provider-specific |
| `gen_ai.request.frequency_penalty` | `GEN_AI_REQUEST_FREQUENCY_PENALTY` | double | `frequency_penalty` | 0.0 |
| `gen_ai.request.presence_penalty` | `GEN_AI_REQUEST_PRESENCE_PENALTY` | double | `presence_penalty` | 0.0 |
| `gen_ai.request.stop_sequences` | `GEN_AI_REQUEST_STOP_SEQUENCES` | array[string] | `stop` | `[]` |
| `gen_ai.request.seed` | `GEN_AI_REQUEST_SEED` | int | `seed` | None |

---

## Response Metadata (Recommended)

| OTel Attribute | Constant | Type | Description | Example |
|----------------|----------|------|-------------|---------|
| `gen_ai.response.id` | `GEN_AI_RESPONSE_ID` | string | Unique response identifier | `"chatcmpl-123"` |
| `gen_ai.response.finish_reasons` | `GEN_AI_RESPONSE_FINISH_REASONS` | array[string] | Why generation stopped | `["stop"]`, `["max_tokens"]` |
| `gen_ai.response.choice_count` | `GEN_AI_RESPONSE_CHOICE_COUNT` | int | Number of choices returned | `1` |
| `gen_ai.response.output_type` | `GEN_AI_RESPONSE_OUTPUT_TYPE` | string | Output format type | `"text"`, `"json_object"` |

---

## Usage Metrics (Recommended)

| OTel Attribute | Constant | Type | Description |
|----------------|----------|------|-------------|
| `gen_ai.usage.input_tokens` | `GEN_AI_USAGE_INPUT_TOKENS` | int | Tokens in input/prompt |
| `gen_ai.usage.output_tokens` | `GEN_AI_USAGE_OUTPUT_TOKENS` | int | Tokens in output/completion |

---

## Server Attributes (Recommended)

| OTel Attribute | Type | Description | Example |
|----------------|------|-------------|---------|
| `server.address` | string | API server hostname/IP | `"api.openai.com"`, `"api.anthropic.com"` |
| `server.port` | int | API server port | `443` |

---

## Evaluation Attributes

| OTel Attribute | Constant | Type | Required | Description | Example |
|----------------|----------|------|----------|-------------|---------|
| `gen_ai.evaluation.name` | `GEN_AI_EVALUATION_NAME` | string | Yes | Type of evaluation | `"hallucination"`, `"bias_detection"` |
| `gen_ai.evaluation.score.value` | `GEN_AI_EVALUATION_SCORE_VALUE` | double | Conditional | Numerical score (0.0-1.0) | `0.85` |
| `gen_ai.evaluation.score.label` | `GEN_AI_EVALUATION_SCORE_LABEL` | string | Conditional | Human-readable label | `"yes"`, `"no"`, `"pass"`, `"fail"` |
| `gen_ai.evaluation.explanation` | `GEN_AI_EVALUATION_EXPLANATION` | string | Recommended | Brief explanation | `"The output contains factual inaccuracies"` |
| `gen_ai.response.id` | `GEN_AI_RESPONSE_ID` | string | Recommended | Response being evaluated | `"chatcmpl-123"` |

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

| OpenAI Parameter | OTel Attribute | Notes |
|------------------|----------------|-------|
| `messages` | `gen_ai.input.messages` | Transform to structured format |
| `model` | `gen_ai.request.model` | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Direct mapping |
| `max_tokens` | `gen_ai.request.max_tokens` | Direct mapping |
| `top_p` | `gen_ai.request.top_p` | Direct mapping |
| `frequency_penalty` | `gen_ai.request.frequency_penalty` | Direct mapping |
| `presence_penalty` | `gen_ai.request.presence_penalty` | Direct mapping |
| `stop` | `gen_ai.request.stop_sequences` | Direct mapping |
| `seed` | `gen_ai.request.seed` | Direct mapping |
| `tools` | `gen_ai.tool.definitions` | Direct mapping |
| `response_format.type` | `gen_ai.response.output_type` | Direct mapping |

Response mapping:
| OpenAI Field | OTel Attribute |
|--------------|----------------|
| `id` | `gen_ai.response.id` |
| `model` | `gen_ai.response.model` |
| `choices[0].message.content` | Part of `gen_ai.output.messages` |
| `choices[0].message.tool_calls` | Part of `gen_ai.output.messages` |
| `choices[0].finish_reason` | Part of `gen_ai.output.messages[0].finish_reason` |
| `usage.prompt_tokens` | `gen_ai.usage.input_tokens` |
| `usage.completion_tokens` | `gen_ai.usage.output_tokens` |

### Anthropic

| Anthropic Parameter | OTel Attribute | Notes |
|---------------------|----------------|-------|
| `messages` | `gen_ai.input.messages` | Transform to structured format |
| `system` | `gen_ai.system_instructions` | Single string (not in messages array) |
| `model` | `gen_ai.request.model` | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Direct mapping |
| `max_tokens` | `gen_ai.request.max_tokens` | Direct mapping |
| `top_p` | `gen_ai.request.top_p` | Direct mapping |
| `top_k` | `gen_ai.request.top_k` | Direct mapping |
| `stop_sequences` | `gen_ai.request.stop_sequences` | Direct mapping |
| `tools` | `gen_ai.tool.definitions` | Transform if needed |

Response mapping:
| Anthropic Field | OTel Attribute |
|-----------------|----------------|
| `id` | `gen_ai.response.id` |
| `model` | `gen_ai.response.model` |
| `content[0].text` | Part of `gen_ai.output.messages` |
| `content[*].type="tool_use"` | Part of `gen_ai.output.messages` |
| `stop_reason` | Map to `gen_ai.output.messages[0].finish_reason` |
| `usage.input_tokens` | `gen_ai.usage.input_tokens` |
| `usage.output_tokens` | `gen_ai.usage.output_tokens` |

### Google (Gemini)

| Google Parameter | OTel Attribute | Notes |
|------------------|----------------|-------|
| `contents` | `gen_ai.input.messages` | Already uses "parts" structure |
| `systemInstruction` | `gen_ai.system_instructions` | Direct mapping |
| `model` | `gen_ai.request.model` | Extract from full name |
| `generationConfig.temperature` | `gen_ai.request.temperature` | Direct mapping |
| `generationConfig.maxOutputTokens` | `gen_ai.request.max_tokens` | Direct mapping |
| `generationConfig.topP` | `gen_ai.request.top_p` | Direct mapping |
| `generationConfig.topK` | `gen_ai.request.top_k` | Direct mapping |
| `generationConfig.stopSequences` | `gen_ai.request.stop_sequences` | Direct mapping |
| `tools` | `gen_ai.tool.definitions` | Transform `function_declarations` |

Response mapping:
| Google Field | OTel Attribute |
|--------------|----------------|
| Response doesn't have ID | `gen_ai.response.id` = None |
| Extracted from request | `gen_ai.response.model` |
| `candidates[0].content.parts[0].text` | Part of `gen_ai.output.messages` |
| `candidates[0].content.parts[*].functionCall` | Part of `gen_ai.output.messages` |
| `candidates[0].finishReason` | Map to `gen_ai.output.messages[0].finish_reason` |
| `usageMetadata.promptTokenCount` | `gen_ai.usage.input_tokens` |
| `usageMetadata.candidatesTokenCount` | `gen_ai.usage.output_tokens` |

### Cohere

| Cohere Parameter | OTel Attribute | Notes |
|------------------|----------------|-------|
| `message` | `gen_ai.input.messages` | Transform to array with user role |
| `chat_history` | `gen_ai.input.messages` | Combine with message |
| `preamble` | `gen_ai.system_instructions` | Direct mapping |
| `model` | `gen_ai.request.model` | Direct mapping |
| `temperature` | `gen_ai.request.temperature` | Direct mapping |
| `max_tokens` | `gen_ai.request.max_tokens` | Direct mapping |
| `p` | `gen_ai.request.top_p` | Direct mapping |
| `k` | `gen_ai.request.top_k` | Direct mapping |
| `stop_sequences` | `gen_ai.request.stop_sequences` | Direct mapping |
| `tools` | `gen_ai.tool.definitions` | Transform format |

Response mapping:
| Cohere Field | OTel Attribute |
|--------------|----------------|
| `generation_id` | `gen_ai.response.id` |
| From request | `gen_ai.response.model` |
| `text` | Part of `gen_ai.output.messages` |
| `tool_calls` | Part of `gen_ai.output.messages` |
| `finish_reason` | Map to `gen_ai.output.messages[0].finish_reason` |
| `meta.tokens.input_tokens` | `gen_ai.usage.input_tokens` |
| `meta.tokens.output_tokens` | `gen_ai.usage.output_tokens` |

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

When implementing event emission:

- [ ] Event name is exactly `gen_ai.client.inference.operation.details`
- [ ] Input messages are structured objects (not JSON strings)
- [ ] Output messages are structured objects (not JSON strings)
- [ ] No data URIs in image references (only HTTP/HTTPS)
- [ ] All required attributes present
- [ ] Finish reasons mapped to OTel standard values
- [ ] Tool definitions included when tools are used
- [ ] Request parameters included when available
- [ ] Response metadata included when available
- [ ] Usage tokens included when available
- [ ] Server address/port included when known

---

## References

- [OTel Gen-AI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md)
- [OTel Gen-AI Attributes](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/README.md)
- [Input Messages JSON Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-input-messages.json)
- [Output Messages JSON Schema](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-output-messages.json)

---

**Last Updated:** 2026-02-12
