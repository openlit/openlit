"""
Google AI Studio OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    common_span_attributes,
    general_tokens,
    otel_event,
    record_completion_metrics,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages):
    """
    Process a list of messages to extract content.
    """

    formatted_messages = []
    prompt = ""

    if isinstance(messages, list):
        try:
            for content in messages:
                role = content.role if content.role is not None else "user"
                parts = content.parts
                content_str = []

                for part in parts:
                    # Collect relevant fields and handle each type of data that Part could contain
                    if part.text:
                        content_str.append(f"text: {part.text}")
                    if part.video_metadata:
                        content_str.append(f"video_metadata: {part.video_metadata}")
                    if part.thought:
                        content_str.append(f"thought: {part.thought}")
                    if part.code_execution_result:
                        content_str.append(
                            f"code_execution_result: {part.code_execution_result}"
                        )
                    if part.executable_code:
                        content_str.append(f"executable_code: {part.executable_code}")
                    if part.file_data:
                        content_str.append(f"file_data: {part.file_data}")
                    if part.function_call:
                        content_str.append(f"function_call: {part.function_call}")
                    if part.function_response:
                        content_str.append(
                            f"function_response: {part.function_response}"
                        )
                    if part.inline_data:
                        content_str.append(f"inline_data: {part.inline_data}")

                formatted_messages.append(f"{role}: {', '.join(content_str)}")

            prompt = "\n".join(formatted_messages)

        except:
            prompt = str(messages)

    else:
        prompt = messages

    return prompt


def build_input_messages(contents, system_instruction=None):
    """
    Convert Google AI Studio contents to OTel input message structure.
    Follows gen-ai-input-messages schema.

    Args:
        contents: Contents array from Google AI Studio request
        system_instruction: Optional system instruction

    Returns:
        List of ChatMessage objects with role and parts
    """

    if not contents:
        return []

    otel_messages = []

    # Add system instruction first if present
    if system_instruction:
        system_text = ""
        if isinstance(system_instruction, str):
            system_text = system_instruction
        elif hasattr(system_instruction, "parts"):
            # Extract text from parts
            for part in system_instruction.parts:
                if hasattr(part, "text") and part.text:
                    system_text += part.text

        if system_text:
            otel_messages.append(
                {"role": "system", "parts": [{"type": "text", "content": system_text}]}
            )

    for content in contents:
        try:
            # Extract role - Google uses "user" and "model"
            role = getattr(content, "role", "user")
            if role == "model":
                role = "assistant"

            parts_list = []

            # Google already uses "parts" structure
            if hasattr(content, "parts"):
                for part in content.parts:
                    # Text content
                    if hasattr(part, "text") and part.text:
                        parts_list.append({"type": "text", "content": part.text})

                    # File data with URI (skip inline_data to avoid data URIs)
                    if hasattr(part, "file_data") and part.file_data:
                        file_uri = getattr(part.file_data, "file_uri", None)
                        mime_type = getattr(part.file_data, "mime_type", "")
                        if file_uri and not file_uri.startswith("data:"):
                            modality = (
                                "image"
                                if "image" in mime_type
                                else "video"
                                if "video" in mime_type
                                else "file"
                            )
                            parts_list.append(
                                {"type": "uri", "modality": modality, "uri": file_uri}
                            )

                    # Function call (tool call from assistant)
                    if hasattr(part, "function_call") and part.function_call:
                        fc = part.function_call
                        parts_list.append(
                            {
                                "type": "tool_call",
                                "id": "",  # Google doesn't provide ID
                                "name": getattr(fc, "name", ""),
                                "arguments": dict(getattr(fc, "args", {})),
                            }
                        )

                    # Function response (tool result from user)
                    if hasattr(part, "function_response") and part.function_response:
                        fr = part.function_response
                        parts_list.append(
                            {
                                "type": "tool_call_response",
                                "id": "",  # Google doesn't provide ID
                                "response": str(getattr(fr, "response", "")),
                            }
                        )

            if parts_list:
                otel_messages.append({"role": role, "parts": parts_list})

        except Exception as e:
            logger.warning("Failed to process input message: %s", e, exc_info=True)
            continue

    return otel_messages


def build_output_messages(response_text, finish_reason, function_calls=None):
    """
    Convert Google AI Studio response to OTel output message structure.
    Follows gen-ai-output-messages schema.

    Args:
        response_text: Response text from model
        finish_reason: Finish reason from Google (STOP, MAX_TOKENS, SAFETY, etc.)
        function_calls: Optional function calls dict from response

    Returns:
        List with single OutputMessage
    """

    parts = []

    try:
        # Add text content if present
        if response_text:
            parts.append({"type": "text", "content": response_text})

        # Add function calls if present
        if function_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": "",  # Google doesn't provide IDs
                    "name": function_calls.get("name", ""),
                    "arguments": function_calls.get("args", {}),
                }
            )

        # Map Google finish reasons to OTel standard
        finish_reason_map = {
            "STOP": "stop",
            "MAX_TOKENS": "max_tokens",
            "SAFETY": "content_filter",
            "RECITATION": "content_filter",
            "OTHER": "other",
            "FINISH_REASON_UNSPECIFIED": "other",
        }

        otel_finish_reason = finish_reason_map.get(
            finish_reason.upper() if finish_reason else "", finish_reason or "stop"
        )

        return [
            {"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}
        ]

    except Exception as e:
        logger.warning("Failed to build output messages: %s", e, exc_info=True)
        return [{"role": "assistant", "parts": [], "finish_reason": "stop"}]


def build_tool_definitions(tools):
    """
    Extract tool/function definitions from Google AI Studio request.

    Args:
        tools: Tools from Google AI Studio request

    Returns:
        List of tool definition objects or None
    """
    if not tools:
        return None

    try:
        tool_definitions = []

        # Google uses function_declarations
        if hasattr(tools, "function_declarations"):
            for func_decl in tools.function_declarations:
                try:
                    # Convert Google schema to OTel format
                    params = {}
                    if hasattr(func_decl, "parameters"):
                        params = {
                            "type": getattr(func_decl.parameters, "type", "object"),
                            "properties": dict(
                                getattr(func_decl.parameters, "properties", {})
                            ),
                            "required": list(
                                getattr(func_decl.parameters, "required", [])
                            ),
                        }

                    tool_definitions.append(
                        {
                            "type": "function",
                            "name": getattr(func_decl, "name", ""),
                            "description": getattr(func_decl, "description", ""),
                            "parameters": params,
                        }
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to process tool definition: %s", e, exc_info=True
                    )
                    continue
        elif isinstance(tools, list):
            # Handle list format
            for tool in tools:
                if isinstance(tool, dict) and "function_declarations" in tool:
                    for func_decl in tool["function_declarations"]:
                        tool_definitions.append(
                            {
                                "type": "function",
                                "name": func_decl.get("name", ""),
                                "description": func_decl.get("description", ""),
                                "parameters": func_decl.get("parameters", {}),
                            }
                        )

        return tool_definitions if tool_definitions else None

    except Exception as e:
        logger.warning("Failed to build tool definitions: %s", e, exc_info=True)
        return None


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
        operation_name: Operation type (chat)
        request_model: Model from request
        response_model: Model from response
        input_messages: Structured input messages
        output_messages: Structured output messages
        tool_definitions: Tool definitions
        server_address: Server address
        server_port: Server port
        **extra_attrs: Additional attributes (temperature, max_tokens, etc.)
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

        # Add messages
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        # Add tool definitions
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Map extra attributes
        for key, value in extra_attrs.items():
            if value is not None:
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
                elif key == "temperature":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
                elif key in ("max_tokens", "max_output_tokens"):
                    attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
                elif key == "top_p":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
                elif key == "top_k":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_K] = value
                elif key == "stop_sequences":
                    attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
                elif key == "input_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
                elif key == "output_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
                elif key == "reasoning_tokens":
                    # Google-specific: thoughts/reasoning tokens
                    attributes[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                else:
                    attributes[key] = value

        # Create and emit event
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )

        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chunk(scope, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    scope._response_id = str(chunked.get("response_id", ""))

    # Handle token usage including reasoning tokens and cached tokens
    usage_metadata = chunked.get("usage_metadata") or {}
    scope._input_tokens = usage_metadata.get("prompt_token_count", 0) or 0
    scope._output_tokens = usage_metadata.get("candidates_token_count", 0) or 0
    scope._reasoning_tokens = usage_metadata.get("thoughts_token_count", 0) or 0
    scope._cache_read_input_tokens = (
        usage_metadata.get("cached_content_token_count", 0) or 0
    )
    scope._cache_creation_input_tokens = (
        usage_metadata.get("cache_creation_input_tokens", 0) or 0
    )

    scope._response_model = chunked.get("model_version")

    if getattr(chunk, "text", None):
        scope._llmresponse += str(chunk.text)
    candidates = chunked.get("candidates") or []
    if candidates:
        scope._finish_reason = str(candidates[0].get("finish_reason", ""))

    try:
        c0 = (chunked.get("candidates") or [{}])[0]
        parts = (c0.get("content") or {}).get("parts") or []
        fc = parts[0].get("function_call") if parts else None
        scope._tools = fc
    except (IndexError, KeyError, TypeError):
        scope._tools = None


def _get_config_value(config, key):
    """Get value from config (dict or object)."""
    if config is None:
        return None
    if isinstance(config, dict):
        return config.get(key)
    return getattr(config, key, None)


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

    prompt = format_content(scope._kwargs.get("contents", ""))
    request_model = scope._kwargs.get("model", "gemini-2.0-flash")

    # Calculate tokens and cost
    if hasattr(scope, "_input_tokens") and scope._input_tokens is not None:
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
        SemanticConvention.GEN_AI_SYSTEM_GEMINI,
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

    inference_config = scope._kwargs.get("config") or {}

    # Span Attributes for Request parameters
    req_attrs = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequency_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presence_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop_sequences"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in req_attrs:
        value = _get_config_value(inference_config, key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
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

    # Span Attributes for Tools
    if hasattr(scope, "_tools") and scope._tools:
        tools = scope._tools if isinstance(scope._tools, dict) else {}
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, tools.get("name", "")
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tools.get("id", ""))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, str(tools.get("args", ""))
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
    if (
        hasattr(scope, "_reasoning_tokens")
        and scope._reasoning_tokens
        and scope._reasoning_tokens > 0
    ):
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
        system_instruction = _get_config_value(inference_config, "system_instruction")
        input_msgs = build_input_messages(
            scope._kwargs.get("contents", []),
            system_instruction=system_instruction,
        )
        output_msgs = build_output_messages(
            scope._llmresponse,
            scope._finish_reason,
            function_calls=scope._tools if hasattr(scope, "_tools") else None,
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
        # gen_ai.system_instructions (Google: from config.system_instruction)
        if system_instruction:
            system_text = ""
            if isinstance(system_instruction, str):
                system_text = system_instruction
            elif hasattr(system_instruction, "parts"):
                for part in system_instruction.parts:
                    if hasattr(part, "text") and part.text:
                        system_text += part.text
            if system_text:
                system_instr = [{"type": "text", "content": system_text}]
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    json.dumps(system_instr),
                )

        # Emit inference event
        if event_provider:
            try:
                tool_defs = build_tool_definitions(
                    _get_config_value(inference_config, "tools")
                )
                output_type = "text" if isinstance(scope._llmresponse, str) else "json"
                extra = {
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [scope._finish_reason],
                    "output_type": output_type,
                    "temperature": _get_config_value(inference_config, "temperature"),
                    "max_tokens": _get_config_value(inference_config, "max_tokens"),
                    "top_p": _get_config_value(inference_config, "top_p"),
                    "top_k": _get_config_value(inference_config, "top_k"),
                    "stop_sequences": _get_config_value(
                        inference_config, "stop_sequences"
                    ),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
                if hasattr(scope, "_reasoning_tokens") and scope._reasoning_tokens:
                    extra["reasoning_tokens"] = scope._reasoning_tokens
                if system_instruction:
                    system_text = ""
                    if isinstance(system_instruction, str):
                        system_text = system_instruction
                    elif hasattr(system_instruction, "parts"):
                        for part in system_instruction.parts:
                            if hasattr(part, "text") and part.text:
                                system_text += part.text
                    if system_text:
                        extra["system_instructions"] = [
                            {"type": "text", "content": system_text}
                        ]
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
            SemanticConvention.GEN_AI_SYSTEM_GEMINI,
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
    instance,
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
    args,
    kwargs,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
):
    """
    Process chat request and generate Telemetry
    """

    self = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    self._start_time = start_time
    self._end_time = time.time()
    self._span = span
    self._llmresponse = str(response.text)

    # Handle token usage including reasoning tokens and cached tokens
    usage_metadata = response_dict.get("usage_metadata") or {}
    self._input_tokens = usage_metadata.get("prompt_token_count", 0) or 0
    self._output_tokens = usage_metadata.get("candidates_token_count", 0) or 0
    self._reasoning_tokens = usage_metadata.get("thoughts_token_count", 0) or 0
    self._cache_read_input_tokens = (
        usage_metadata.get("cached_content_token_count", 0) or 0
    )
    self._cache_creation_input_tokens = (
        usage_metadata.get("cache_creation_input_tokens", 0) or 0
    )

    self._response_id = str(response_dict.get("response_id", ""))
    self._response_model = response_dict.get("model_version")
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    candidates = response_dict.get("candidates") or []
    self._finish_reason = (
        str(candidates[0].get("finish_reason", "")) if candidates else ""
    )

    try:
        c0 = (response_dict.get("candidates") or [{}])[0]
        parts = (c0.get("content") or {}).get("parts") or []
        self._tools = parts[0].get("function_call") if parts else None
    except (IndexError, KeyError, TypeError):
        self._tools = None

    common_chat_logic(
        self,
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
