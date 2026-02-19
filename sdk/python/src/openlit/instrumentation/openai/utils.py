"""
OpenAI OpenTelemetry instrumentation utility functions
"""

import json
import time
import logging

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    get_embed_model_cost,
    get_audio_model_cost,
    get_image_model_cost,
    general_tokens,
    record_completion_metrics,
    record_embedding_metrics,
    record_audio_metrics,
    record_image_metrics,
    common_span_attributes,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def handle_not_given(value, default=None):
    """
    Handle OpenAI's NotGiven values and None values by converting them to appropriate defaults.
    """
    if hasattr(value, "__class__") and value.__class__.__name__ == "NotGiven":
        return default
    if value is None:
        return default
    return value


def format_content(messages):
    """
    Format the messages into a string for span events.
    Handles both chat completions format and responses API input format.
    """

    if not messages:
        return ""

    # Handle string input (simple case)
    if isinstance(messages, str):
        return messages

    # Handle list of messages
    formatted_messages = []

    for message in messages:
        try:
            role = message.get("role", "user") or message.role
            content = message.get("content", "") or message.content

        except:
            role = "user"
            content = str(messages)

        if isinstance(content, list):
            content_str_list = []
            for item in content:
                # Chat completions format
                if item.get("type") == "text":
                    content_str_list.append(f"text: {item.get('text', '')}")
                elif item.get("type") == "image_url" and not item.get(
                    "image_url", {}
                ).get("url", "").startswith("data:"):
                    content_str_list.append(f"image_url: {item['image_url']['url']}")

                # Responses API format
                elif item.get("type") == "input_text":
                    content_str_list.append(f"text: {item.get('text', '')}")
                elif item.get("type") == "input_image":
                    image_url = item.get("image_url", "")
                    if image_url and not image_url.startswith("data:"):
                        content_str_list.append(f"image_url: {image_url}")

            content_str = ", ".join(content_str_list)
            formatted_messages.append(f"{role}: {content_str}")
        else:
            formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert OpenAI request messages to OTel input message structure.
    Follows https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-input-messages.json

    Args:
        messages: OpenAI messages array from request

    Returns:
        List of ChatMessage objects with role and parts
    """
    if not messages:
        return []

    # Handle string input (simple case)
    if isinstance(messages, str):
        return [{"role": "user", "parts": [{"type": "text", "content": messages}]}]

    otel_messages = []

    for message in messages:
        try:
            # Extract role
            role = (
                message.get("role", "user")
                if isinstance(message, dict)
                else getattr(message, "role", "user")
            )

            # Extract content
            content = (
                message.get("content", "")
                if isinstance(message, dict)
                else getattr(message, "content", "")
            )

            # Build parts array
            parts = []

            if isinstance(content, list):
                # Multi-part content
                for item in content:
                    item_type = (
                        item.get("type")
                        if isinstance(item, dict)
                        else getattr(item, "type", None)
                    )

                    # Chat completions format
                    if item_type == "text":
                        text_content = (
                            item.get("text", "")
                            if isinstance(item, dict)
                            else getattr(item, "text", "")
                        )
                        if text_content:
                            parts.append({"type": "text", "content": text_content})

                    elif item_type == "image_url":
                        image_url_obj = (
                            item.get("image_url", {})
                            if isinstance(item, dict)
                            else getattr(item, "image_url", {})
                        )
                        if isinstance(image_url_obj, dict):
                            url = image_url_obj.get("url", "")
                        else:
                            url = getattr(image_url_obj, "url", "")

                        # Skip data URIs
                        if url and not url.startswith("data:"):
                            parts.append(
                                {"type": "uri", "modality": "image", "uri": url}
                            )

                    # Responses API format
                    elif item_type == "input_text":
                        text_content = (
                            item.get("text", "")
                            if isinstance(item, dict)
                            else getattr(item, "text", "")
                        )
                        if text_content:
                            parts.append({"type": "text", "content": text_content})

                    elif item_type == "input_image":
                        image_url = (
                            item.get("image_url", "")
                            if isinstance(item, dict)
                            else getattr(item, "image_url", "")
                        )
                        if image_url and not image_url.startswith("data:"):
                            parts.append(
                                {"type": "uri", "modality": "image", "uri": image_url}
                            )

                    # Tool call response (assistant sending tool results)
                    elif item_type == "tool_call":
                        tool_call_obj = (
                            item
                            if isinstance(item, dict)
                            else {
                                "id": getattr(item, "id", ""),
                                "name": getattr(item, "name", ""),
                                "arguments": getattr(item, "arguments", {}),
                            }
                        )
                        parts.append(
                            {
                                "type": "tool_call",
                                "id": tool_call_obj.get("id", ""),
                                "name": tool_call_obj.get("name", ""),
                                "arguments": tool_call_obj.get("arguments", {}),
                            }
                        )

            elif isinstance(content, str) and content:
                # Simple string content
                parts.append({"type": "text", "content": content})

            # Handle tool_call_id for tool role messages
            if role == "tool":
                tool_call_id = (
                    message.get("tool_call_id", "")
                    if isinstance(message, dict)
                    else getattr(message, "tool_call_id", "")
                )
                tool_content = content if isinstance(content, str) else str(content)
                # For tool responses, use tool_call_response part type
                parts = [
                    {
                        "type": "tool_call_response",
                        "id": tool_call_id,
                        "response": tool_content,
                    }
                ]

            if parts:  # Only add message if it has content
                otel_message = {"role": role, "parts": parts}

                # Add optional name if present
                name = (
                    message.get("name")
                    if isinstance(message, dict)
                    else getattr(message, "name", None)
                )
                if name:
                    otel_message["name"] = name

                otel_messages.append(otel_message)

        except Exception as e:
            logger.warning("Failed to process input message: %s", e, exc_info=True)
            continue

    return otel_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert OpenAI response to OTel output message structure.
    Follows https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-output-messages.json

    Args:
        response_text: Response text from model
        finish_reason: Finish reason from OpenAI
        tool_calls: Optional tool calls from response

    Returns:
        List with single OutputMessage (for choice 0)
    """
    parts = []

    try:
        # Add text content if present
        if response_text:
            parts.append({"type": "text", "content": response_text})

        # Add tool calls if present
        if tool_calls:
            if isinstance(tool_calls, list):
                for tool_call in tool_calls:
                    try:
                        # Extract tool call data
                        if isinstance(tool_call, dict):
                            tool_id = tool_call.get("id", "")
                            tool_name = tool_call.get("name", "")
                            tool_args = tool_call.get("arguments", {})
                        else:
                            tool_id = getattr(tool_call, "id", "")
                            tool_name = getattr(tool_call, "name", "")
                            tool_args = getattr(tool_call, "arguments", {})

                        # Parse arguments if it's a string
                        if isinstance(tool_args, str):
                            try:
                                import json

                                tool_args = json.loads(tool_args)
                            except:
                                tool_args = {"raw": tool_args}

                        parts.append(
                            {
                                "type": "tool_call",
                                "id": tool_id,
                                "name": tool_name,
                                "arguments": tool_args,
                            }
                        )
                    except Exception as e:
                        logger.warning(
                            "Failed to process tool call: %s", e, exc_info=True
                        )
                        continue
            elif isinstance(tool_calls, str):
                # Tool calls stored as string (comma-separated names)
                # Just add as text note
                pass

        # Map OpenAI finish reasons to OTel finish reasons
        finish_reason_map = {
            "stop": "stop",
            "length": "length",
            "content_filter": "content_filter",
            "tool_calls": "tool_call",
            "function_call": "tool_call",
        }

        otel_finish_reason = finish_reason_map.get(
            finish_reason, finish_reason or "stop"
        )

        return [
            {"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}
        ]

    except Exception as e:
        logger.warning("Failed to build output messages: %s", e, exc_info=True)
        # Return minimal valid structure
        return [{"role": "assistant", "parts": [], "finish_reason": "stop"}]


def build_tool_definitions(tools):
    """
    Extract tool/function definitions from request.

    Args:
        tools: Tools array from OpenAI request

    Returns:
        List of tool definition objects or None
    """
    if not tools:
        return None

    try:
        tool_definitions = []

        for tool in tools:
            try:
                if isinstance(tool, dict):
                    # Extract function definition
                    if tool.get("type") == "function" and "function" in tool:
                        func = tool["function"]
                        tool_definitions.append(
                            {
                                "type": "function",
                                "name": func.get("name", ""),
                                "description": func.get("description", ""),
                                "parameters": func.get("parameters", {}),
                            }
                        )
                else:
                    # Handle object format
                    if getattr(tool, "type", None) == "function":
                        func = getattr(tool, "function", None)
                        if func:
                            tool_definitions.append(
                                {
                                    "type": "function",
                                    "name": getattr(func, "name", ""),
                                    "description": getattr(func, "description", ""),
                                    "parameters": getattr(func, "parameters", {}),
                                }
                            )
            except Exception as e:
                logger.warning(
                    "Failed to process tool definition: %s", e, exc_info=True
                )
                continue

        return tool_definitions if tool_definitions else None

    except Exception as e:
        logger.warning("Failed to build tool definitions: %s", e, exc_info=True)
        return None


def build_system_instructions_from_messages(messages):
    """
    Extract system message(s) from chat messages for gen_ai.system_instructions.
    Returns list of { type: "text", content: "..." } per OTel schema, or None.
    """
    if not messages:
        return None
    instructions = []
    for msg in messages:
        role = (
            msg.get("role", "") if isinstance(msg, dict) else getattr(msg, "role", "")
        )
        if role != "system":
            continue
        content = (
            msg.get("content", "")
            if isinstance(msg, dict)
            else getattr(msg, "content", "")
        )
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text = part.get("text", "")
                    if text:
                        instructions.append({"type": "text", "content": text})
        elif content:
            instructions.append({"type": "text", "content": str(content)})
    return instructions if instructions else None


def _set_span_messages_as_array(span, input_messages, output_messages):
    """Set gen_ai.input.messages and gen_ai.output.messages on span as JSON array strings (OTel)."""
    try:
        if input_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                json.dumps(input_messages)
                if isinstance(input_messages, list)
                else input_messages,
            )
        if output_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps(output_messages)
                if isinstance(output_messages, list)
                else output_messages,
            )
    except Exception as e:
        logger.warning("Failed to set span message attributes: %s", e, exc_info=True)


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
    **extra_attrs,
):
    """
    Emit gen_ai.client.inference.operation.details event.

    Args:
        event_provider: The OTel event provider
        operation_name: Operation type (chat, embeddings, etc.)
        request_model: Model from request
        response_model: Model from response
        input_messages: Structured input messages (optional)
        output_messages: Structured output messages (optional)
        tool_definitions: Tool definitions (optional)
        server_address: Server address (optional)
        server_port: Server port (optional)
        **extra_attrs: Additional attributes (response_id, finish_reasons, etc.)
    """
    try:
        if not event_provider:
            return

        # Build event attributes
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
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        # Add message attributes (structured format required for events per OTel spec)
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        # Add tool definitions
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Add extra attributes with proper mapping to semantic conventions
        for key, value in extra_attrs.items():
            if value is not None:
                # Map common keys to semantic conventions
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
                elif key == "conversation_id":
                    # Note: OpenAI doesn't provide conversation_id, but included for completeness
                    attributes["gen_ai.conversation.id"] = value
                elif key == "temperature":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
                elif key == "max_tokens":
                    attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
                elif key == "top_p":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
                elif key == "frequency_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = (
                        value
                    )
                elif key == "presence_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = (
                        value
                    )
                elif key == "stop_sequences":
                    attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
                elif key == "seed":
                    attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
                elif key in ("choice_count", "n"):
                    # Only add if not 1 (per spec: conditionally required if ≠1)
                    if value != 1:
                        attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = (
                            value
                        )
                elif key == "input_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
                elif key == "output_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                else:
                    # Pass through any other attributes as-is
                    attributes[key] = value

        # Create and emit event
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",  # Per spec, all data in attributes
        )

        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chat_chunk(scope, chunk):
    """
    Process a chunk of chat response data and update state.
    """

    end_time = time.time()
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    # Extract content from chat completions
    if len(chunked.get("choices", [])) > 0 and "delta" in chunked.get("choices")[0]:
        delta = chunked.get("choices")[0]["delta"]
        content = delta.get("content")
        if content:
            scope._llmresponse += content

        # Handle tool calls in streaming - optimized
        delta_tools = delta.get("tool_calls")
        if delta_tools:
            scope._tools = scope._tools or []

            for tool in delta_tools:
                idx = tool.get("index", 0)

                # Extend list if needed
                scope._tools.extend([{}] * (idx + 1 - len(scope._tools)))

                if tool.get("id"):  # New tool (id exists)
                    func = tool.get("function", {})
                    scope._tools[idx] = {
                        "id": tool["id"],
                        "function": {
                            # Use `or ""` to handle explicit None values from some providers
                            "name": func.get("name") or "",
                            "arguments": func.get("arguments") or "",
                        },
                        "type": tool.get("type", "function"),
                    }
                elif (
                    scope._tools[idx] and "function" in tool
                ):  # Append args (id is None)
                    # Handle None arguments - some providers return None instead of ""
                    new_args = tool["function"].get("arguments") or ""
                    if scope._tools[idx]["function"]["arguments"] is None:
                        scope._tools[idx]["function"]["arguments"] = new_args
                    else:
                        scope._tools[idx]["function"]["arguments"] += new_args

    # Extract metadata
    scope._response_id = chunked.get("id") or scope._response_id
    scope._response_model = chunked.get("model") or scope._response_model

    try:
        scope._finish_reason = (
            chunked.get("choices", [])[0].get("finish_reason") or scope._finish_reason
        )
    except (IndexError, AttributeError, TypeError):
        scope._finish_reason = "stop"

    scope._system_fingerprint = (
        chunked.get("system_fingerprint") or scope._system_fingerprint
    )
    scope._service_tier = chunked.get("service_tier") or scope._service_tier


def process_response_chunk(scope, chunk):
    """
    Process a chunk of response API data and update state.
    """

    end_time = time.time()
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    # Extract content from responses API
    if chunked.get("type") == "response.output_text.delta":
        scope._llmresponse += chunked.get("delta", "")

    # Handle tool calls in streaming for responses API
    elif chunked.get("type") == "response.output_item.added":
        # New tool call item added
        if not hasattr(scope, "_response_tools") or scope._response_tools is None:
            scope._response_tools = []

        item = chunked.get("item", {})
        if item.get("type") == "function_call":
            scope._response_tools.append(
                {
                    "id": item.get("id", ""),
                    "call_id": item.get("call_id", ""),
                    "name": item.get("name", ""),
                    "type": item.get("type", "function_call"),
                    "arguments": item.get("arguments", ""),
                    "status": item.get("status", "in_progress"),
                }
            )

    elif chunked.get("type") == "response.function_call_arguments.delta":
        # Tool arguments being streamed
        if hasattr(scope, "_response_tools") and scope._response_tools:
            item_id = chunked.get("item_id", "")
            delta = chunked.get("delta", "")

            # Find the tool by item_id and append arguments
            for tool in scope._response_tools:
                if tool.get("id") == item_id:
                    tool["arguments"] += delta
                    break

    elif chunked.get("type") == "response.function_call_arguments.done":
        # Tool arguments complete
        if hasattr(scope, "_response_tools") and scope._response_tools:
            item_id = chunked.get("item_id", "")
            final_arguments = chunked.get("arguments", "")

            # Update the tool with final arguments
            for tool in scope._response_tools:
                if tool.get("id") == item_id:
                    tool["arguments"] = final_arguments
                    break

    elif chunked.get("type") == "response.output_item.done":
        # Tool call item complete
        if hasattr(scope, "_response_tools") and scope._response_tools:
            item = chunked.get("item", {})
            item_id = item.get("id", "")

            # Update the tool with final status and data
            for tool in scope._response_tools:
                if tool.get("id") == item_id:
                    tool.update(
                        {
                            "call_id": item.get("call_id", tool.get("call_id", "")),
                            "name": item.get("name", tool.get("name", "")),
                            "arguments": item.get(
                                "arguments", tool.get("arguments", "")
                            ),
                            "status": item.get("status", "completed"),
                        }
                    )
                    break

    elif chunked.get("type") == "response.completed":
        response_data = chunked.get("response", {})
        scope._response_id = response_data.get("id") or scope._response_id
        scope._response_model = response_data.get("model") or scope._response_model
        scope._finish_reason = response_data.get("status")
        instructions_raw = response_data.get("instructions")
        scope._instructions = (
            [{"type": "text", "content": instructions_raw}]
            if instructions_raw
            else None
        )

        usage = response_data.get("usage", {})
        scope._input_tokens = usage.get("input_tokens", 0)
        scope._output_tokens = usage.get("output_tokens", 0)

        # Handle reasoning tokens
        output_tokens_details = usage.get("output_tokens_details", {})
        scope._reasoning_tokens = output_tokens_details.get("reasoning_tokens", 0)

        # Cached tokens (OTel: gen_ai.usage.cache_read.input_tokens)
        input_tokens_details = usage.get("input_tokens_details", {})
        scope._cache_read_input_tokens = input_tokens_details.get("cached_tokens", 0)


def common_response_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    is_stream,
    event_provider=None,
):
    """
    Process responses API request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    # For responses API, format input using the same function as chat completions
    input_data = scope._kwargs.get("input", "")
    prompt = format_content(input_data)
    request_model = scope._kwargs.get("model", "gpt-4o")

    # Calculate tokens and cost
    if hasattr(scope, "_input_tokens") and scope._input_tokens:
        input_tokens = scope._input_tokens
        output_tokens = scope._output_tokens
    else:
        input_tokens = general_tokens(prompt)
        output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # OpenAI-specific API type attribute (TIER 2: OpenAI-Specific Semconv)
    scope._span.set_attribute(
        SemanticConvention.OPENAI_API_TYPE,
        "responses",  # Responses API type
    )

    # Span Attributes for Request parameters specific to responses API
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        handle_not_given(scope._kwargs.get("temperature"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        handle_not_given(scope._kwargs.get("top_p"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        handle_not_given(scope._kwargs.get("max_output_tokens"), -1),
    )

    # Reasoning parameters
    reasoning = scope._kwargs.get("reasoning", {})
    if reasoning:
        if reasoning.get("effort"):
            scope._span.set_attribute(
                "gen_ai.request.reasoning_effort", reasoning.get("effort")
            )

    # OpenAI: response.service_tier (from response); request.service_tier (from request when not 'auto')
    if hasattr(scope, "_service_tier") and scope._service_tier:
        scope._span.set_attribute(
            SemanticConvention.OPENAI_RESPONSE_SERVICE_TIER, scope._service_tier
        )
    req_tier = handle_not_given(scope._kwargs.get("service_tier"))
    if req_tier and str(req_tier) != "auto":
        scope._span.set_attribute(
            SemanticConvention.OPENAI_REQUEST_SERVICE_TIER, str(req_tier)
        )
    # gen_ai.request.choice.count when n != 1
    n_choices = handle_not_given(scope._kwargs.get("n"), 1)
    if n_choices != 1:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, int(n_choices)
        )

    # Span Attributes for Response parameters
    if scope._response_id:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text")

    # Span Attributes for Tools (responses API structure) - optimized
    if hasattr(scope, "_response_tools") and scope._response_tools:
        tools = (
            scope._response_tools
            if isinstance(scope._response_tools, list)
            else [scope._response_tools]
        )

        names, ids, args = (
            zip(
                *[
                    (
                        t.get("name", ""),
                        str(t.get("call_id", "")),  # Use call_id for responses API
                        str(t.get("arguments", "")),
                    )
                    for t in tools
                    if isinstance(t, dict) and t
                ]
            )
            if tools
            else ([], [], [])
        )

        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, ", ".join(filter(None, names))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, ", ".join(filter(None, ids))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, ", ".join(filter(None, args))
        )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Reasoning tokens
    if hasattr(scope, "_reasoning_tokens") and scope._reasoning_tokens > 0:
        scope._span.set_attribute(
            "gen_ai.usage.reasoning_tokens", scope._reasoning_tokens
        )

    # OTel cached token attributes (set even when 0)
    if hasattr(scope, "_cache_read_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
            scope._cache_read_input_tokens,
        )
    if hasattr(scope, "_cache_creation_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            scope._cache_creation_input_tokens,
        )

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        input_msgs = build_input_messages(input_data)
        output_msgs = build_output_messages(
            scope._llmresponse,
            scope._finish_reason,
            scope._response_tools if hasattr(scope, "_response_tools") else None,
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
        # gen_ai.system_instructions (Responses API: from response.instructions)
        if getattr(scope, "_instructions", None):
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                json.dumps(scope._instructions),
            )

        # Emit inference event
        if event_provider:
            try:
                extra = {
                    "response_id": scope._response_id,
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text",
                    "temperature": handle_not_given(
                        scope._kwargs.get("temperature"), 1.0
                    ),
                    "max_tokens": handle_not_given(
                        scope._kwargs.get("max_output_tokens"), -1
                    ),
                    "top_p": handle_not_given(scope._kwargs.get("top_p"), 1.0),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
                if getattr(scope, "_instructions", None):
                    extra["system_instructions"] = scope._instructions
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=None,  # Responses API doesn't expose tools upfront
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
        )


def process_streaming_response_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content=False,
    disable_metrics=False,
    version="",
    event_provider=None,
):
    """
    Process streaming responses API response and generate telemetry.
    """

    common_response_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=True,
        event_provider=event_provider,
    )


def process_response_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming responses API response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span

    # Extract content from responses API structure with reasoning support
    output = response_dict.get("output", [])
    scope._llmresponse = ""
    scope._response_tools = None

    if output:
        # Find the message item in the output array (might not be first if reasoning is present)
        message_item = None
        for item in output:
            if item.get("type") == "message":
                message_item = item
                break
            if item.get("type") == "function_call":
                # Handle tool call
                scope._response_tools = [
                    {
                        "id": item.get("id", ""),
                        "call_id": item.get("call_id", ""),
                        "name": item.get("name", ""),
                        "type": item.get("type", "function_call"),
                        "arguments": item.get("arguments", ""),
                        "status": item.get("status", ""),
                    }
                ]

        # Extract content from message item if found
        if message_item:
            content = message_item.get("content", [])
            if content and len(content) > 0:
                scope._llmresponse = content[0].get("text", "")

    scope._response_id = response_dict.get("id", "")
    scope._response_model = response_dict.get("model", "")

    # Handle token usage including reasoning tokens and cached tokens
    usage = response_dict.get("usage", {})
    scope._input_tokens = usage.get("input_tokens", 0)
    scope._output_tokens = usage.get("output_tokens", 0)

    output_tokens_details = usage.get("output_tokens_details", {})
    scope._reasoning_tokens = output_tokens_details.get("reasoning_tokens", 0)

    input_tokens_details = usage.get("input_tokens_details", {})
    scope._cache_read_input_tokens = input_tokens_details.get("cached_tokens", 0)

    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._service_tier = response_dict.get("service_tier", "default")
    scope._finish_reason = response_dict.get("status", "completed")
    # Responses API: top-level instructions -> gen_ai.system_instructions
    instructions_raw = response_dict.get("instructions")
    scope._instructions = (
        [{"type": "text", "content": instructions_raw}] if instructions_raw else None
    )

    common_response_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=False,
        event_provider=event_provider,
    )

    return response


def common_chat_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    is_stream,
    event_provider=None,
):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    # Format messages for chat operations
    if hasattr(scope, "_operation_type") and scope._operation_type == "responses":
        # Handle responses API input format using format_content
        input_data = scope._kwargs.get("input", "")
        prompt = format_content(input_data)
    else:
        # Handle standard chat format
        prompt = format_content(scope._kwargs.get("messages", []))

    request_model = scope._kwargs.get("model", "gpt-4o")

    # Calculate tokens and cost
    if hasattr(scope, "_input_tokens") and scope._input_tokens:
        input_tokens = scope._input_tokens
        output_tokens = scope._output_tokens
    else:
        input_tokens = general_tokens(prompt)
        output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # OpenAI-specific API type attribute (TIER 2: OpenAI-Specific Semconv)
    scope._span.set_attribute(
        SemanticConvention.OPENAI_API_TYPE,
        "chat_completions",  # Chat API type
    )

    # Span Attributes for Request parameters
    seed_value = handle_not_given(scope._kwargs.get("seed"))
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SEED,
        int(seed_value) if seed_value else 0,
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        handle_not_given(scope._kwargs.get("frequency_penalty"), 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        handle_not_given(scope._kwargs.get("max_tokens"), -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        handle_not_given(scope._kwargs.get("presence_penalty"), 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        handle_not_given(scope._kwargs.get("stop"), []),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        handle_not_given(scope._kwargs.get("temperature"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        handle_not_given(scope._kwargs.get("top_p"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_USER,
        handle_not_given(scope._kwargs.get("user"), ""),
    )

    # Span Attributes for Response parameters
    if scope._response_id:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # OpenAI-specific attributes
    if hasattr(scope, "_system_fingerprint") and scope._system_fingerprint:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT,
            scope._system_fingerprint,
        )
    if hasattr(scope, "_service_tier") and scope._service_tier:
        scope._span.set_attribute(
            SemanticConvention.OPENAI_RESPONSE_SERVICE_TIER, scope._service_tier
        )
    req_tier = handle_not_given(scope._kwargs.get("service_tier"))
    if req_tier and str(req_tier) != "auto":
        scope._span.set_attribute(
            SemanticConvention.OPENAI_REQUEST_SERVICE_TIER, str(req_tier)
        )
    n_choices = handle_not_given(scope._kwargs.get("n"), 1)
    if n_choices != 1:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, int(n_choices)
        )

    # Span Attributes for Tools - optimized
    if hasattr(scope, "_tools") and scope._tools:
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]

        names, ids, args = (
            zip(
                *[
                    (
                        t.get("function", {}).get("name", ""),
                        str(t.get("id", "")),
                        str(t.get("function", {}).get("arguments", "")),
                    )
                    for t in tools
                    if isinstance(t, dict) and t
                ]
            )
            if tools
            else ([], [], [])
        )

        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, ", ".join(filter(None, names))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, ", ".join(filter(None, ids))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, ", ".join(filter(None, args))
        )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # OTel cached token attributes (set even when 0)
    if hasattr(scope, "_cache_read_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
            scope._cache_read_input_tokens,
        )
    if hasattr(scope, "_cache_creation_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            scope._cache_creation_input_tokens,
        )

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        if hasattr(scope, "_operation_type") and scope._operation_type == "responses":
            input_data = scope._kwargs.get("input", "")
            input_msgs = build_input_messages(input_data)
        else:
            input_msgs = build_input_messages(scope._kwargs.get("messages", []))
        output_msgs = build_output_messages(
            scope._llmresponse,
            scope._finish_reason,
            scope._tools if hasattr(scope, "_tools") else None,
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
        # gen_ai.system_instructions (Chat: extract system messages from messages)
        chat_messages = scope._kwargs.get("messages", [])
        system_instr = build_system_instructions_from_messages(chat_messages)
        if system_instr:
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                json.dumps(system_instr),
            )

        # Emit inference event
        if event_provider:
            try:
                tool_defs = build_tool_definitions(scope._kwargs.get("tools"))
                extra = {
                    "response_id": scope._response_id,
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": handle_not_given(
                        scope._kwargs.get("temperature"), 1.0
                    ),
                    "max_tokens": handle_not_given(scope._kwargs.get("max_tokens"), -1),
                    "top_p": handle_not_given(scope._kwargs.get("top_p"), 1.0),
                    "frequency_penalty": handle_not_given(
                        scope._kwargs.get("frequency_penalty"), 0.0
                    ),
                    "presence_penalty": handle_not_given(
                        scope._kwargs.get("presence_penalty"), 0.0
                    ),
                    "stop_sequences": handle_not_given(scope._kwargs.get("stop"), []),
                    "seed": int(handle_not_given(scope._kwargs.get("seed"), 0))
                    if handle_not_given(scope._kwargs.get("seed"))
                    else None,
                    "choice_count": scope._kwargs.get("n", 1),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
                if system_instr:
                    extra["system_instructions"] = system_instr
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=tool_defs,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
        )


def process_streaming_chat_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content=False,
    disable_metrics=False,
    version="",
    event_provider=None,
):
    """
    Process streaming chat response and generate telemetry.
    """

    common_chat_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=True,
        event_provider=event_provider,
    )


def process_chat_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming chat response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._llmresponse = " ".join(
        (choice.get("message", {}).get("content") or "")
        for choice in response_dict.get("choices", [])
    )
    scope._response_id = response_dict.get("id", "")
    scope._response_model = response_dict.get("model", "")
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
    scope._output_tokens = response_dict.get("usage", {}).get("completion_tokens", 0)

    # Extract cache tokens (OpenAI prompt caching)
    prompt_tokens_details = response_dict.get("usage", {}).get(
        "prompt_tokens_details", {}
    )
    scope._cache_read_input_tokens = prompt_tokens_details.get("cached_tokens", 0)

    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._system_fingerprint = response_dict.get("system_fingerprint", "")
    scope._service_tier = response_dict.get("service_tier", "auto")
    scope._finish_reason = (
        str(response_dict.get("choices", [])[0].get("finish_reason", ""))
        if response_dict.get("choices")
        else ""
    )

    # Handle operation type for responses API
    if kwargs.get("_operation_type") == "responses":
        scope._operation_type = "responses"

    # Handle tool calls
    if kwargs.get("tools"):
        scope._tools = (
            response_dict.get("choices", [{}])[0].get("message", {}).get("tool_calls")
        )
    else:
        scope._tools = None

    common_chat_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=False,
        event_provider=event_provider,
    )

    return response


def common_embedding_logic(
    scope,
    request_model,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Common logic for processing embedding operations.
    """

    # Calculate cost
    cost = get_embed_model_cost(request_model, pricing_info, scope._input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        False,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS,
        [handle_not_given(scope._kwargs.get("encoding_format"), "float")],
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_USER,
        handle_not_given(scope._kwargs.get("user"), ""),
    )
    # gen_ai.embeddings.dimension.count (from request or response when available)
    dim_count = handle_not_given(scope._kwargs.get("dimensions"))
    if dim_count is None and getattr(scope, "_embedding_dimension", None) is not None:
        dim_count = scope._embedding_dimension
    if dim_count is not None:
        try:
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, int(dim_count)
            )
        except (TypeError, ValueError):
            pass

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages)
    if capture_message_content:
        input_data = scope._kwargs.get("input", "")
        if isinstance(input_data, list):
            input_msgs = [
                {"role": "user", "parts": [{"type": "text", "content": str(item)}]}
                for item in input_data
            ]
        else:
            input_msgs = [
                {
                    "role": "user",
                    "parts": [{"type": "text", "content": str(input_data)}],
                }
            ]
        _set_span_messages_as_array(scope._span, input_msgs, None)

        # Emit inference event
        if event_provider:
            try:
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                    request_model=request_model,
                    response_model=request_model,
                    input_messages=input_msgs,
                    output_messages=None,  # Embeddings don't have text output
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    input_tokens=scope._input_tokens,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_embedding_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._input_tokens,
            cost,
        )


def common_image_logic(
    scope,
    request_model,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Common logic for processing image operations.
    """

    # Calculate cost
    cost = get_image_model_cost(
        request_model,
        pricing_info,
        scope._kwargs.get("size", "1024x1024"),
        scope._kwargs.get("quality", "standard"),
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        False,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE,
        handle_not_given(scope._kwargs.get("size"), "1024x1024"),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY,
        handle_not_given(scope._kwargs.get("quality"), "standard"),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_USER,
        handle_not_given(scope._kwargs.get("user"), ""),
    )

    # Extract response data
    response_dict = scope._response_dict
    images_data = response_dict.get("data", [])
    response_created = response_dict.get("created")
    response_size = response_dict.get("size")
    response_quality = response_dict.get("quality")
    response_output_format = response_dict.get("output_format")

    # Span Attributes for Response
    if response_created:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, str(response_created)
        )

    # Process image data and collect URLs/base64 content
    if images_data:
        # Collect image URLs or base64 content
        image_contents = []

        for image in images_data:
            # Collect image content (URL or base64)
            if image.get("url"):
                image_contents.append(image["url"])
            elif image.get("b64_json"):
                # For base64, we typically dont want to store the full content in spans
                # Just indicate its base64 format
                image_contents.append("[base64_image_data]")

        # Set image response data using semantic conventions
        if image_contents:
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_RESPONSE_IMAGE, image_contents
            )

    # Response-level attributes if different from request
    if response_size:
        scope._span.set_attribute("gen_ai.response.image_size", response_size)
    if response_quality:
        scope._span.set_attribute("gen_ai.response.image_quality", response_quality)
    if response_output_format:
        scope._span.set_attribute(
            "gen_ai.response.output_format", response_output_format
        )

    # Span Attributes for Cost
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content (OTel: array structure)
    if capture_message_content:
        prompt = scope._kwargs.get("prompt", "")
        input_msgs = (
            [{"role": "user", "parts": [{"type": "text", "content": prompt}]}]
            if prompt
            else []
        )
        output_msgs = []

        # Collect and set revised prompts if available
        if images_data:
            revised_prompts = []
            for image in images_data:
                if image.get("revised_prompt"):
                    revised_prompts.append(image["revised_prompt"])

            # Set revised prompts as span attribute if any were found
            if revised_prompts:
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT, revised_prompts
                )

            # Build output messages with revised prompts as text parts
            for image in images_data:
                parts = []
                if image.get("revised_prompt"):
                    parts.append({"type": "text", "content": image["revised_prompt"]})
                if image.get("url"):
                    parts.append(
                        {
                            "type": "uri",
                            "modality": "image",
                            "uri": image["url"],
                        }
                    )
                if parts:
                    output_msgs.append(
                        {
                            "role": "assistant",
                            "parts": parts,
                            "finish_reason": "stop",
                        }
                    )
        _set_span_messages_as_array(
            scope._span, input_msgs, output_msgs if output_msgs else None
        )

        if event_provider:
            try:
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                    request_model=request_model,
                    response_model=request_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs if output_msgs else None,
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    response_id=str(response_created) if response_created else None,
                    output_type="image",
                    choice_count=scope._kwargs.get("n", 1),
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_image_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
        )


def common_audio_logic(
    scope,
    request_model,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Common logic for processing audio operations.
    """

    # Calculate cost
    input_text = scope._kwargs.get("input", "")
    cost = get_audio_model_cost(request_model, pricing_info, input_text)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        False,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
        handle_not_given(scope._kwargs.get("voice"), "alloy"),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
        handle_not_given(scope._kwargs.get("response_format"), "mp3"),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED,
        handle_not_given(scope._kwargs.get("speed"), 1.0),
    )

    # Span Attributes for Cost
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content (OTel: array structure)
    if capture_message_content:
        input_text = scope._kwargs.get("input", "")
        input_msgs = (
            [{"role": "user", "parts": [{"type": "text", "content": input_text}]}]
            if input_text
            else []
        )
        output_msgs = [
            {
                "role": "assistant",
                "parts": [{"type": "text", "content": "[audio generated]"}],
                "finish_reason": "stop",
            }
        ]
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                    request_model=request_model,
                    response_model=request_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_audio_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
        )


def process_audio_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    end_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process audio generation response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = end_time
    scope._span = span
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    common_audio_logic(
        scope,
        request_model,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider=event_provider,
    )

    return response


def process_embedding_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process embedding response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    # gen_ai.embeddings.dimension.count from response when not in request
    data = response_dict.get("data", [])
    if data and isinstance(data[0], dict) and data[0].get("embedding"):
        scope._embedding_dimension = len(data[0]["embedding"])
    else:
        scope._embedding_dimension = None

    common_embedding_logic(
        scope,
        request_model,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider=event_provider,
    )

    return response


def process_image_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    end_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process image generation response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = end_time
    scope._span = span
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._response_dict = response_dict

    common_image_logic(
        scope,
        request_model,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider=event_provider,
    )

    return response
