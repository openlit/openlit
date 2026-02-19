"""
Google AI Studio OpenTelemetry instrumentation utility functions
"""

import time
from opentelemetry.sdk.resources import (
    SERVICE_NAME,
    TELEMETRY_SDK_NAME,
    DEPLOYMENT_ENVIRONMENT,
)
from opentelemetry.trace import Status, StatusCode
from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    create_metrics_attributes,
)
from openlit.semcov import SemanticConvention


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

    Args:
        contents: Contents array from Google AI Studio request
        system_instruction: Optional system instruction

    Returns:
        List of ChatMessage objects with role and parts
    """
    import logging

    logger = logging.getLogger(__name__)

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

    Args:
        response_text: Response text from model
        finish_reason: Finish reason from Google (STOP, MAX_TOKENS, SAFETY, etc.)
        function_calls: Optional function calls dict from response

    Returns:
        List with single OutputMessage
    """
    import logging

    logger = logging.getLogger(__name__)

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
    import logging

    logger = logging.getLogger(__name__)

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
    import logging

    logger = logging.getLogger(__name__)

    try:
        if not event_provider:
            return

        from openlit.__helpers import otel_event

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

        # Create and emit event
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )

        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chunk(self, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    # Record the timestamp for the current chunk
    self._timestamps.append(end_time)

    if len(self._timestamps) == 1:
        # Calculate time to first chunk
        self._ttft = calculate_ttft(self._timestamps, self._start_time)

    chunked = response_as_dict(chunk)

    self._response_id = str(chunked.get("response_id"))

    # Extract usage including cache tokens (Google prompt caching)
    usage_metadata = chunked.get("usage_metadata", {})
    self._input_tokens = usage_metadata.get("prompt_token_count", 0)
    self._output_tokens = usage_metadata.get("candidates_token_count", 0)
    self._reasoning_tokens = usage_metadata.get("thoughts_token_count") or 0
    self._cache_read_input_tokens = usage_metadata.get("cached_content_token_count", 0)

    self._response_model = chunked.get("model_version")

    if chunk.text:
        self._llmresponse += str(chunk.text)
    self._finish_reason = str(chunked.get("candidates")[0].get("finish_reason"))

    try:
        self._tools = (
            chunked.get("candidates", [])[0]
            .get("content", {})
            .get("parts", [])[0]
            .get("function_call", "")
        )
    except:
        self._tools = None


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

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Set Span attributes (OTel Semconv)
    scope._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_GEMINI
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT, scope._server_port)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS, scope._server_address)

    inference_config = scope._kwargs.get("config", {})

    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequency_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presence_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop_sequences"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]

    # Set each attribute if the corresponding value exists and is not None
    for attribute, key in attributes:
        # Use getattr to get the attribute value from the object
        value = getattr(inference_config, key, None)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_MODEL, scope._response_model
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, scope._reasoning_tokens
    )

    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    scope._span.set_attribute(SERVICE_NAME, application_name)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, is_stream)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT, scope._tbt)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, scope._ttft)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        scope._input_tokens + scope._output_tokens + scope._reasoning_tokens,
    )

    if scope._tools:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, scope._tools.get("name", "")
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, str(scope._tools.get("id", ""))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, str(scope._tools.get("args", ""))
        )

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt)
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES, scope._llmresponse
        )

        # Emit inference event
        if event_provider:
            import logging

            logger = logging.getLogger(__name__)
            try:
                input_msgs = build_input_messages(
                    scope._kwargs.get("contents", []),
                    system_instruction=getattr(
                        inference_config, "system_instruction", None
                    ),
                )
                output_msgs = build_output_messages(
                    scope._llmresponse,
                    scope._finish_reason,
                    function_calls=scope._tools,
                )
                tool_defs = build_tool_definitions(
                    getattr(inference_config, "tools", None)
                )

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
                    finish_reasons=[scope._finish_reason],
                    temperature=getattr(inference_config, "temperature", None),
                    max_output_tokens=getattr(inference_config, "max_tokens", None),
                    top_p=getattr(inference_config, "top_p", None),
                    top_k=getattr(inference_config, "top_k", None),
                    stop_sequences=getattr(inference_config, "stop_sequences", None),
                    input_tokens=scope._input_tokens,
                    output_tokens=scope._output_tokens,
                    reasoning_tokens=scope._reasoning_tokens,
                    cache_read_input_tokens=scope._cache_read_input_tokens
                    if hasattr(scope, "_cache_read_input_tokens")
                    and scope._cache_read_input_tokens > 0
                    else None,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        metrics_attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvention.GEN_AI_SYSTEM_GEMINI,
            request_model=request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=scope._response_model,
        )

        metrics["genai_client_operation_duration"].record(
            scope._end_time - scope._start_time, metrics_attributes
        )
        metrics["genai_server_tbt"].record(scope._tbt, metrics_attributes)
        metrics["genai_server_ttft"].record(scope._ttft, metrics_attributes)
        metrics["genai_requests"].add(1, metrics_attributes)
        metrics["genai_completion_tokens"].add(scope._output_tokens, metrics_attributes)
        metrics["genai_prompt_tokens"].add(scope._input_tokens, metrics_attributes)
        metrics["genai_reasoning_tokens"].add(
            scope._reasoning_tokens, metrics_attributes
        )
        metrics["genai_cost"].record(cost, metrics_attributes)
        metrics["genai_client_usage_tokens"].record(
            scope._input_tokens + scope._output_tokens + scope._reasoning_tokens,
            metrics_attributes,
        )


def process_streaming_chat_response(
    self,
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
    Process chat request and generate Telemetry
    """

    common_chat_logic(
        self,
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

    # Extract usage including cache tokens (Google prompt caching)
    usage_metadata = response_dict.get("usage_metadata", {})
    self._input_tokens = usage_metadata.get("prompt_token_count", 0)
    self._output_tokens = usage_metadata.get("candidates_token_count", 0)
    self._reasoning_tokens = usage_metadata.get("thoughts_token_count") or 0
    self._cache_read_input_tokens = usage_metadata.get("cached_content_token_count", 0)

    self._response_model = response_dict.get("model_version")
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    self._finish_reason = str(response_dict.get("candidates")[0].get("finish_reason"))

    try:
        self._tools = (
            response_dict.get("candidates", [])[0]
            .get("content", {})
            .get("parts", [])[0]
            .get("function_call", "")
        )
    except:
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
