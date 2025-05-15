"""
Ollama OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    general_tokens,
    extract_and_format_input,
    get_chat_model_cost,
    get_embed_model_cost,
    handle_exception,
    create_metrics_attributes,
    otel_event,
    concatenate_all_contents
)
from openlit.semcov import SemanticConvention

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
    self._llmresponse += chunked.get('message', {}).get('content', '')

    if chunked.get('message', {}).get('tool_calls'):
        self._tool_calls = chunked['message']['tool_calls']

    if chunked.get('eval_count'):
        self._response_role = chunked.get('message', {}).get('role', '')
        self._input_tokens = chunked.get('prompt_eval_count', 0)
        self._output_tokens = chunked.get('eval_count', 0)
        self._response_model = chunked.get('model', '')
        self._finish_reason = chunked.get('done_reason', '')

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    json_body = scope._kwargs.get("json", {}) or {}
    request_model = json_body.get("model") or scope._kwargs.get("model")
    messages = json_body.get("messages", scope._kwargs.get("messages", ""))
    formatted_messages = extract_and_format_input(messages)

    cost = get_chat_model_cost(request_model, pricing_info, scope._input_tokens, scope._output_tokens)

    # Set Span attributes (OTel Semconv)
    scope._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_OLLAMA)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT, scope._server_port)

    options = scope._kwargs.get('options', {})
    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'repeat_penalty'),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 'max_tokens'),
        (SemanticConvention.GEN_AI_REQUEST_SEED, 'seed'),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop'),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, 'top_p'),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, 'top_k'),
    ]

    for attribute, key in attributes:
        value = options.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason])
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, scope._response_model)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS, scope._server_address)

    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                              "text" if isinstance(scope._llmresponse, str) else "json")

    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    scope._span.set_attribute(SERVICE_NAME, application_name)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, is_stream)
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens + scope._output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT, scope._tbt)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, scope._ttft)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

    # To be removed one the change to log events (from span events) is complete
    prompt = concatenate_all_contents(formatted_messages)
    if capture_message_content:
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
            },
        )
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_COMPLETION: scope._llmresponse,
            },
        )

    choice_event_body = {
        "finish_reason": scope._finish_reason,
        "index": 0,
        "message": {
            **({"content": scope._llmresponse} if capture_message_content else {}),
            "role": scope._response_role
        }
    }

    if scope._tool_calls:
        function_call = scope._tool_calls[0]
        choice_event_body["message"].update({
            "tool_calls": {
                "function": {
                    "name": function_call.get('function', {}).get('name', ''),
                    "arguments": function_call.get('function', {}).get('arguments', '')
                },
                "id": function_call.get('id', ''),
                "type": "function"
            }
        })

    # Emit events
    for role in ['user', 'system', 'assistant', 'tool']:
        if formatted_messages.get(role, {}).get('content', ''):
            event = otel_event(
                name=getattr(SemanticConvention, f'GEN_AI_{role.upper()}_MESSAGE'),
                attributes={
                    SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_OLLAMA
                },
                body = {
                    # pylint: disable=line-too-long
                    **({"content": formatted_messages.get(role, {}).get('content', '')} if capture_message_content else {}),
                    "role": formatted_messages.get(role, {}).get('role', []),
                    **({
                        "tool_calls": {
                            "function": {
                                # pylint: disable=line-too-long
                                "name": (scope._tool_calls[0].get('function', {}).get('name', '') if scope._tool_calls else ''),
                                "arguments": (scope._tool_calls[0].get('function', {}).get('arguments', '') if scope._tool_calls else '')
                            },
                            "id": (scope._tool_calls[0].get('id', '') if scope._tool_calls else ''),
                            "type": "function"
                        }
                    } if role == 'assistant' else {}),
                    **({
                        "id": (scope._tool_calls[0].get('id', '') if scope._tool_calls else '')
                    } if role == 'tool' else {})
                }
            )
            event_provider.emit(event)

    choice_event = otel_event(
        name=SemanticConvention.GEN_AI_CHOICE,
        attributes={
            SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_OLLAMA
        },
        body=choice_event_body
    )
    event_provider.emit(choice_event)

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        metrics_attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            request_model=request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=scope._response_model,
        )

        metrics["genai_client_usage_tokens"].record(scope._input_tokens + scope._output_tokens, metrics_attributes)
        metrics["genai_client_operation_duration"].record(scope._end_time - scope._start_time, metrics_attributes)
        metrics["genai_server_tbt"].record(scope._tbt, metrics_attributes)
        metrics["genai_server_ttft"].record(scope._ttft, metrics_attributes)
        metrics["genai_requests"].add(1, metrics_attributes)
        metrics["genai_completion_tokens"].add(scope._output_tokens, metrics_attributes)
        metrics["genai_prompt_tokens"].add(scope._input_tokens, metrics_attributes)
        metrics["genai_cost"].record(cost, metrics_attributes)

def process_streaming_chat_response(self, pricing_info, environment, application_name, metrics,
                                    event_provider, capture_message_content=False, disable_metrics=False, version=''):
    """
    Process chat request and generate Telemetry
    """

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream=True)

def process_chat_response(response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, event_provider, start_time,
                          span, capture_message_content=False, disable_metrics=False, version="1.0.0", **kwargs):
    """
    Process chat request and generate Telemetry
    """

    self = type('GenericScope', (), {})()

    # pylint: disable = no-member
    self._start_time = start_time
    self._end_time = time.time()
    self._span = span
    self._llmresponse = response.get('message', {}).get('content', '')
    self._response_role = response.get('message', {}).get('role', 'assistant')
    self._input_tokens = response.get('prompt_eval_count')
    self._output_tokens = response.get('eval_count')
    self._response_model = response.get('model', '')
    self._finish_reason = response.get('done_reason', '')
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    self._tool_calls = response.get('message', {}).get('tool_calls', [])

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream=False)

    return response

def process_embedding_response(response, request_model, pricing_info, server_port, server_address,
        environment, application_name, metrics, event_provider,
        start_time, span, capture_message_content=False, disable_metrics=False, version="1.0.0", **kwargs):
    """
    Process embedding request and generate Telemetry
    """

    end_time = time.time()

    try:
        json_body = kwargs.get("json", {}) or {}
        prompt_val = json_body.get('prompt', kwargs.get('prompt', ''))
        input_tokens = general_tokens(str(prompt_val))

        # Calculate cost of the operation
        cost = get_embed_model_cost(request_model,
                            pricing_info, input_tokens)

        # Set Span attributes (OTel Semconv)
        span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
        span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING)
        span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                            SemanticConvention.GEN_AI_SYSTEM_OLLAMA)
        span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                            request_model)
        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                            request_model)
        span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                            server_address)
        span.set_attribute(SemanticConvention.SERVER_PORT,
                            server_port)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                            input_tokens)

        # Set Span attributes (Extras)
        span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                            environment)
        span.set_attribute(SERVICE_NAME,
                            application_name)
        span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
                            input_tokens)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                            cost)
        span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                            version)

        prompt_event = otel_event(
            name=SemanticConvention.GEN_AI_USER_MESSAGE,
            attributes={
                SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_OLLAMA
            },
            body={
                **({"content": prompt_val} if capture_message_content else {}),
                "role":  'user'
            }
        )
        event_provider.emit(prompt_event)

        span.set_status(Status(StatusCode.OK))

        if disable_metrics is False:
            attributes = create_metrics_attributes(
                service_name=application_name,
                deployment_environment=environment,
                operation=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                system=SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
                request_model=request_model,
                server_address=server_address,
                server_port=server_port,
                response_model=request_model,
            )
            metrics['genai_client_usage_tokens'].record(
                    input_tokens, attributes
                )
            metrics['genai_client_operation_duration'].record(
                end_time - start_time, attributes
            )
            metrics['genai_requests'].add(1, attributes)
            metrics['genai_prompt_tokens'].add(input_tokens, attributes)
            metrics['genai_cost'].record(cost, attributes)

        # Return original response
        return response

    except Exception as e:
        handle_exception(span, e)

        # Return original response
        return response
