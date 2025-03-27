"""
Azure AI Inference OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    extract_and_format_input,
    get_chat_model_cost,
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

    # Collect message IDs and aggregated response from events
    if (len(chunked.get('choices')) > 0 and ('delta' in chunked.get('choices')[0] and
        'content' in chunked.get('choices')[0].get('delta'))):

        if content := chunked.get('choices')[0].get('delta').get('content'):
            self._llmresponse += content

    if chunked.get('choices')[0].get('finish_reason') is not None:
        self._finish_reason = chunked.get('choices')[0].get('finish_reason')

    if chunked.get('usage') is not None:
        self._input_tokens = chunked.get('usage').get('prompt_tokens')
        self._response_id = chunked.get('id')
        self._response_model = chunked.get('model')
        self._output_tokens = chunked.get('usage').get('completion_tokens')

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    formatted_messages = extract_and_format_input(scope._kwargs.get('messages', ''))
    request_model = scope._kwargs.get('model', 'claude-3-opus-20240229')

    cost = get_chat_model_cost(request_model, pricing_info, scope._input_tokens, scope._output_tokens)

    # Set Span attributes (OTel Semconv)
    scope._span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT, scope._server_port)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, scope._kwargs.get('max_tokens', -1))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, scope._kwargs.get('stop', []))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, scope._kwargs.get('temperature', 1.0))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, scope._kwargs.get('top_k', 1.0))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, scope._kwargs.get('top_p', 1.0))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                                          scope._kwargs.get('frequency_penalty', 0.0))
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                                          scope._kwargs.get('presence_penalty', 0.0))
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason])
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, scope._response_model)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS, scope._server_address)

    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                              'text' if isinstance(scope._llmresponse, str) else 'json')

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
        'finish_reason': scope._finish_reason,
        'index': 0,
        'message': {
            **({'content': scope._llmresponse} if capture_message_content else {}),
            'role': 'assistant'
        }
    }

    # Emit events
    for role in ['user', 'system', 'assistant', 'tool']:
        if formatted_messages.get(role, {}).get('content', ''):
            event = otel_event(
                name=getattr(SemanticConvention, f'GEN_AI_{role.upper()}_MESSAGE'),
                attributes={
                    SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE
                },
                body = {
                    # pylint: disable=line-too-long
                    **({'content': formatted_messages.get(role, {}).get('content', '')} if capture_message_content else {}),
                    'role': formatted_messages.get(role, {}).get('role', []),
                    **({
                        'tool_calls': {
                            'function': {
                                # pylint: disable=line-too-long
                                'name': (scope._tool_calls[0].get('function', {}).get('name', '') if scope._tool_calls else ''),
                                'arguments': (scope._tool_calls[0].get('function', {}).get('arguments', '') if scope._tool_calls else '')
                            },
                            'id': (scope._tool_calls[0].get('id', '') if scope._tool_calls else ''),
                            'type': 'function'
                        }
                    } if role == 'assistant' else {}),
                    **({
                        'id': (scope._tool_calls[0].get('id', '') if scope._tool_calls else '')
                    } if role == 'tool' else {})
                }
            )
            event_provider.emit(event)

    choice_event = otel_event(
        name=SemanticConvention.GEN_AI_CHOICE,
        attributes={
            SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE
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
            system=SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
            request_model=request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=scope._response_model,
        )

        metrics['genai_client_usage_tokens'].record(scope._input_tokens + scope._output_tokens, metrics_attributes)
        metrics['genai_client_operation_duration'].record(scope._end_time - scope._start_time, metrics_attributes)
        metrics['genai_server_tbt'].record(scope._tbt, metrics_attributes)
        metrics['genai_server_ttft'].record(scope._ttft, metrics_attributes)
        metrics['genai_requests'].add(1, metrics_attributes)
        metrics['genai_completion_tokens'].add(scope._output_tokens, metrics_attributes)
        metrics['genai_prompt_tokens'].add(scope._input_tokens, metrics_attributes)
        metrics['genai_cost'].record(cost, metrics_attributes)

def process_streaming_chat_response(self, pricing_info, environment, application_name, metrics,
                                    event_provider, capture_message_content=False, disable_metrics=False, version=''):
    """
    Process chat request and generate Telemetry
    """

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream=True)

def process_chat_response(response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, event_provider, start_time,
                          span, capture_message_content=False, disable_metrics=False, version='1.0.0', **kwargs):
    """
    Process chat request and generate Telemetry
    """

    self = type('GenericScope', (), {})()
    response_dict = response_as_dict(response)

    # pylint: disable = no-member
    self._start_time = start_time
    self._end_time = time.time()
    self._span = span
    self._llmresponse = response_dict.get('choices', {})[0].get('message', '').get('content', '')
    self._input_tokens = response_dict.get('usage').get('prompt_tokens')
    self._output_tokens = response_dict.get('usage').get('completion_tokens')
    self._response_model = response_dict.get('model', '')
    self._finish_reason = response_dict.get('choices', {})[0].get('finish_reason', '')
    self._response_id = response_dict.get('id', '')
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream=False)

    return response
