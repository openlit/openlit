"""
AI21 OpenTelemetry instrumentation utility functions
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
    handle_exception,
    create_metrics_attributes,
    otel_event,
    concatenate_all_contents
)
from openlit.semcov import SemanticConvention

def setup_common_span_attributes(span, request_model, kwargs, tokens,
                                 server_port, server_address, environment,
                                 application_name, extra_attrs):
    """
    Set common span attributes for both chat and RAG operations.
    """

    # Base attributes from SDK and operation settings.
    span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_AI21)
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED, kwargs.get('seed', ''))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, kwargs.get('frequency_penalty', 0.0))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, kwargs.get('max_tokens', -1))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, kwargs.get('presence_penalty', 0.0))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, kwargs.get('stop', []))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, kwargs.get('temperature', 0.4))
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, kwargs.get('top_p', 1.0))

    # Add token-related attributes if available.
    if 'finish_reason' in tokens:
        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [tokens['finish_reason']])
    if 'response_id' in tokens:
        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, tokens['response_id'])
    if 'input_tokens' in tokens:
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, tokens['input_tokens'])
    if 'output_tokens' in tokens:
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, tokens['output_tokens'])
    if 'total_tokens' in tokens:
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, tokens['total_tokens'])

    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)
    span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
    # Environment and service identifiers.
    span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    span.set_attribute(SERVICE_NAME, application_name)
    # Set any extra attributes passed in.
    for key, value in extra_attrs.items():
        span.set_attribute(key, value)

def record_common_metrics(metrics, application_name, environment, request_model,
                          server_address, server_port, start_time, end_time,
                          input_tokens, output_tokens, cost, include_tbt=False, tbt_value=None):
    """
    Record common metrics for the operation.
    """

    attributes = create_metrics_attributes(
        service_name=application_name,
        deployment_environment=environment,
        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        system=SemanticConvention.GEN_AI_SYSTEM_AI21,
        request_model=request_model,
        server_address=server_address,
        server_port=server_port,
        response_model=request_model,
    )
    metrics['genai_client_usage_tokens'].record(input_tokens + output_tokens, attributes)
    metrics['genai_client_operation_duration'].record(end_time - start_time, attributes)
    if include_tbt and tbt_value is not None:
        metrics['genai_server_tbt'].record(tbt_value, attributes)
    metrics['genai_server_ttft'].record(end_time - start_time, attributes)
    metrics['genai_requests'].add(1, attributes)
    metrics['genai_completion_tokens'].add(output_tokens, attributes)
    metrics['genai_prompt_tokens'].add(input_tokens, attributes)
    metrics['genai_cost'].record(cost, attributes)

def emit_common_events(event_provider, choices, finish_reason, llmresponse, formatted_messages,
                       capture_message_content, n):
    """
    Emit events common to both chat and chat rag operations.
    """

    if n > 1:
        for choice in choices:
            choice_event_body = {
                'finish_reason': finish_reason,
                'index': choice.get('index', 0),
                'message': {
                    **({'content': choice.get('message', {}).get('content', '')} if capture_message_content else {}),
                    'role': choice.get('message', {}).get('role', 'assistant')
                }
            }
            # If tool calls exist, emit an event for each tool call.
            tool_calls = choice.get('message', {}).get('tool_calls')
            if tool_calls:
                for tool_call in tool_calls:
                    choice_event_body['message'].update({
                        'tool_calls': {
                            'function': {
                                'name': tool_call.get('function', {}).get('name', ''),
                                'arguments': tool_call.get('function', {}).get('arguments', '')
                            },
                            'id': tool_call.get('id', ''),
                            'type': tool_call.get('type', 'function')
                        }
                    })
                    event = otel_event(
                        name=SemanticConvention.GEN_AI_CHOICE,
                        attributes={SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AI21},
                        body=choice_event_body
                    )
                    event_provider.emit(event)
            else:
                event = otel_event(
                    name=SemanticConvention.GEN_AI_CHOICE,
                    attributes={SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AI21},
                    body=choice_event_body
                )
                event_provider.emit(event)
    else:
        # Single choice case.
        choice_event_body = {
            'finish_reason': finish_reason,
            'index': 0,
            'message': {
                **({'content': llmresponse} if capture_message_content else {}),
                'role': 'assistant'
            }
        }
        event = otel_event(
            name=SemanticConvention.GEN_AI_CHOICE,
            attributes={SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AI21},
            body=choice_event_body
        )
        event_provider.emit(event)

    # Emit additional role-based events (if formatted messages are available).
    for role in ['user', 'system', 'assistant', 'tool']:
        msg = formatted_messages.get(role, {})
        if msg.get('content', ''):
            event_body = {
                **({'content': msg.get('content', '')} if capture_message_content else {}),
                'role': msg.get('role', [])
            }
            # For assistant messages, attach tool call details if they exist.
            if role == 'assistant' and choices:
                tool_calls = choices[0].get('message', {}).get('tool_calls', [])
                if tool_calls:
                    event_body['tool_calls'] = {
                        'function': {
                            'name': tool_calls[0].get('function', {}).get('name', ''),
                            'arguments': tool_calls[0].get('function', {}).get('arguments', '')
                        },
                        'id': tool_calls[0].get('id', ''),
                        'type': 'function'
                    }
            if role == 'tool' and choices:
                tool_calls = choices[0].get('message', {}).get('tool_calls', [])
                if tool_calls:
                    event_body['id'] = tool_calls[0].get('id', '')
            event = otel_event(
                name=getattr(SemanticConvention, f'GEN_AI_{role.upper()}_MESSAGE'),
                attributes={SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AI21},
                body=event_body
            )
            event_provider.emit(event)

def process_chunk(self, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    # Record the timestamp for the current chunk.
    self._timestamps.append(end_time)
    if len(self._timestamps) == 1:
        # Calculate time-to-first-chunk (TTFT).
        self._ttft = calculate_ttft(self._timestamps, self._start_time)

    chunked = response_as_dict(chunk)
    if (len(chunked.get('choices')) > 0 and
            'delta' in chunked.get('choices')[0] and
            'content' in chunked.get('choices')[0].get('delta')):
        content = chunked.get('choices')[0].get('delta').get('content')
        if content:
            self._llmresponse += content
        if chunked.get('usage'):
            self._input_tokens = chunked.get('usage').get('prompt_tokens')
            self._output_tokens = chunked.get('usage').get('completion_tokens')
    self._response_id = chunked.get('id')
    self._choices += chunked.get('choices')
    self._finish_reason = chunked.get('choices')[0].get('finish_reason')

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                      event_provider, capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry.
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    # Extract and format input messages.
    formatted_messages = extract_and_format_input(scope._kwargs.get('messages', ''))
    prompt = concatenate_all_contents(formatted_messages)
    request_model = scope._kwargs.get('model', 'jamba-1.5-mini')

    # Calculate cost based on token usage.
    cost = get_chat_model_cost(request_model, pricing_info, scope._input_tokens, scope._output_tokens)
    # Prepare tokens dictionary.
    tokens = {
        'finish_reason': scope._finish_reason,
        'response_id': scope._response_id,
        'input_tokens': scope._input_tokens,
        'output_tokens': scope._output_tokens,
        'total_tokens': scope._input_tokens + scope._output_tokens,
    }
    extra_attrs = {
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM: is_stream,
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE: scope._input_tokens + scope._output_tokens,
        SemanticConvention.GEN_AI_USAGE_COST: cost,
        SemanticConvention.GEN_AI_SERVER_TBT: scope._tbt,
        SemanticConvention.GEN_AI_SERVER_TTFT: scope._ttft,
        SemanticConvention.GEN_AI_SDK_VERSION: version,
        SemanticConvention.GEN_AI_OUTPUT_TYPE: 'text' if isinstance(scope._llmresponse, str) else 'json'
    }
    # Set span attributes.
    setup_common_span_attributes(scope._span, request_model, scope._kwargs, tokens,
                                 scope._server_port, scope._server_address, environment,
                                 application_name, extra_attrs)

    # Optionally add events capturing the prompt and completion.
    if capture_message_content:
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt},
        )
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={SemanticConvention.GEN_AI_CONTENT_COMPLETION: scope._llmresponse},
        )

    # Emit events for each choice and message role.
    n = scope._kwargs.get('n', 1)
    emit_common_events(event_provider, scope._choices, scope._finish_reason, scope._llmresponse,
                       formatted_messages, capture_message_content, n)

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        record_common_metrics(metrics, application_name, environment, request_model,
                              scope._server_address, scope._server_port,
                              scope._start_time, scope._end_time,
                              scope._input_tokens, scope._output_tokens, cost,
                              include_tbt=True, tbt_value=scope._tbt)

def process_streaming_chat_response(self, pricing_info, environment, application_name, metrics,
                                    event_provider, capture_message_content=False, disable_metrics=False, version=''):
    """
    Process a streaming chat response and generate Telemetry.
    """

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                      event_provider, capture_message_content, disable_metrics, version, is_stream=True)

def process_chat_response(response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, event_provider, start_time,
                          span, capture_message_content=False, disable_metrics=False, version='1.0.0', **kwargs):
    """
    Process a synchronous chat response and generate Telemetry.
    """

    # Create a generic scope object to hold telemetry data.
    self = type('GenericScope', (), {})()
    response_dict = response_as_dict(response)

    # pylint: disable = no-member
    self._start_time = start_time
    self._end_time = time.time()

    self._span = span
    # Concatenate content from all choices.
    self._llmresponse = ''.join(
        (choice.get('message', {}).get('content') or '')
        for choice in response_dict.get('choices', [])
    )
    self._response_role = response_dict.get('message', {}).get('role', 'assistant')
    self._input_tokens = response_dict.get('usage', {}).get('prompt_tokens', 0)
    self._output_tokens = response_dict.get('usage', {}).get('completion_tokens', 0)
    self._response_id = response_dict.get('id', '')
    self._response_model = request_model
    self._finish_reason = response_dict.get('choices', [{}])[0].get('finish_reason')
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    self._choices = response_dict.get('choices')

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                      event_provider, capture_message_content, disable_metrics, version, is_stream=False)

    return response

def process_chat_rag_response(response, request_model, pricing_info, server_port, server_address,
                              environment, application_name, metrics, event_provider, start_time,
                              span, capture_message_content=False, disable_metrics=False, version='1.0.0', **kwargs):
    """
    Process a chat response and generate Telemetry.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)
    try:
        # Format input messages into a single prompt string.
        messages_input = kwargs.get('messages', '')
        formatted_messages = extract_and_format_input(messages_input)
        prompt = concatenate_all_contents(formatted_messages)
        input_tokens = general_tokens(prompt)

        # Create tokens dict and RAG-specific extra attributes.
        tokens = {'response_id': response_dict.get('id'), 'input_tokens': input_tokens}
        extra_attrs = {
            SemanticConvention.GEN_AI_REQUEST_IS_STREAM: False,
            SemanticConvention.GEN_AI_SERVER_TTFT: end_time - start_time,
            SemanticConvention.GEN_AI_SDK_VERSION: version,
            SemanticConvention.GEN_AI_RAG_MAX_SEGMENTS: kwargs.get('max_segments', -1),
            SemanticConvention.GEN_AI_RAG_STRATEGY: kwargs.get('retrieval_strategy', 'segments'),
            SemanticConvention.GEN_AI_RAG_SIMILARITY_THRESHOLD: kwargs.get('retrieval_similarity_threshold', -1),
            SemanticConvention.GEN_AI_RAG_MAX_NEIGHBORS: kwargs.get('max_neighbors', -1),
            SemanticConvention.GEN_AI_RAG_FILE_IDS: str(kwargs.get('file_ids', '')),
            SemanticConvention.GEN_AI_RAG_DOCUMENTS_PATH: kwargs.get('path', '')
        }
        # Set common span attributes.
        setup_common_span_attributes(span, request_model, kwargs, tokens,
                                     server_port, server_address, environment, application_name,
                                     extra_attrs)

        # Record the prompt event if requested.
        if capture_message_content:
            span.add_event(
                name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                attributes={SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt},
            )

        output_tokens = 0
        choices = response_dict.get('choices', [])
        # Instead of adding a separate event per choice, we aggregate all completion content.
        aggregated_completion = []
        for i in range(kwargs.get('n', 1)):
            # Get the response content from each choice and count tokens.
            content = choices[i].get('content', '')
            aggregated_completion.append(content)
            output_tokens += general_tokens(content)
            if kwargs.get('tools'):
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALLS,
                                   str(choices[i].get('message', {}).get('tool_calls')))
            # Set output type based on actual content type.
            if isinstance(content, str):
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text')
            elif content is not None:
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'json')

        # Concatenate completion responses.
        llmresponse = ''.join(aggregated_completion)
        tokens['output_tokens'] = output_tokens
        tokens['total_tokens'] = input_tokens + output_tokens

        cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, input_tokens + output_tokens)

        span.set_status(Status(StatusCode.OK))
        # Emit a single aggregated completion event.
        if capture_message_content:
            span.add_event(
                name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                attributes={SemanticConvention.GEN_AI_CONTENT_COMPLETION: llmresponse},
            )
        # Emit the rest of the events (choice and role-based events) as before.
        n = kwargs.get('n', 1)
        emit_common_events(event_provider, choices, choices[0].get('finish_reason', ''),
                           llmresponse, formatted_messages, capture_message_content, n)

        if not disable_metrics:
            record_common_metrics(metrics, application_name, environment, request_model,
                                  server_address, server_port, start_time, end_time,
                                  input_tokens, output_tokens, cost, include_tbt=False)
        return response

    except Exception as e:
        handle_exception(span, e)
        return response
