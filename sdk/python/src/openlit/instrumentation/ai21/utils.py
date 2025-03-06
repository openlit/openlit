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
    get_embed_model_cost,
    handle_exception,
    create_metrics_attributes,
    otel_event,
    concatenate_all_contents
)
from openlit.semcov import SemanticConvetion

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
    if (len(chunked.get('choices')) > 0 and ('delta' in chunked.get('choices')[0] and
        'content' in chunked.get('choices')[0].get('delta'))):

        content = chunked.get('choices')[0].get('delta').get('content')
        if content:
            self._llmresponse += content

        if chunked.get('usage'):
            self._input_tokens = chunked.get('usage').get("prompt_tokens")
            self._output_tokens = chunked.get('usage').get("completion_tokens")

    self._response_id = chunked.get('id')
    self._choices += chunked.get('choices')
    self._finish_reason = chunked.get('choices')[0].get('finish_reason')

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    formatted_messages = extract_and_format_input(scope._kwargs.get("messages", ""))
    request_model = scope._kwargs.get("model", "jamba-1.5-mini")

    cost = get_chat_model_cost(request_model, pricing_info, scope._input_tokens, scope._output_tokens)

    # Set Span attributes (OTel Semconv)
    scope._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    scope._span.set_attribute(SemanticConvetion.GEN_AI_OPERATION, SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM, SemanticConvetion.GEN_AI_SYSTEM_AI21)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL, request_model)
    scope._span.set_attribute(SemanticConvetion.SERVER_PORT, scope._server_port)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED, scope._kwargs.get("seed", ""))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                        scope._kwargs.get("frequency_penalty", 0.0))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                        scope._kwargs.get("max_tokens", -1))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                        scope._kwargs.get("presence_penalty", 0.0))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES,
                        scope._kwargs.get("stop", []))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                        scope._kwargs.get("temperature", 0.4))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                        scope._kwargs.get("top_p", 1.0))
    scope._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason])
    scope._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL, request_model)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens)
    scope._span.set_attribute(SemanticConvetion.SERVER_ADDRESS, scope._server_address)

    scope._span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                              "text" if isinstance(scope._llmresponse, str) else "json")

    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    scope._span.set_attribute(SERVICE_NAME, application_name)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM, is_stream)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens + scope._output_tokens)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST, cost)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TBT, scope._tbt)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT, scope._ttft)
    scope._span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION, version)

    # To be removed one the change to log events (from span events) is complete
    prompt = concatenate_all_contents(formatted_messages)
    if capture_message_content:
        scope._span.add_event(
            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
            },
        )
        scope._span.add_event(
            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: scope._llmresponse,
            },
        )

    if scope._kwargs.get('n', 1) > 1:
        # Assuming `scope._choices` is the list of choices
        for choice in scope._choices:
            # Access properties from the choice
            choice_event_body = {
                "finish_reason": scope._finish_reason,
                "index": choice.get('index', 0),
                "message": {
                    **({"content": choice.get('message', {}).get('content', '')} if capture_message_content else {}),
                    "role": choice.get('message', {}).get('role', 'assistant')
                }
            }

            # Check if there are tool calls to process
            if choice.get('message', {}).get('tool_calls'):
                for tool_call in choice.get('message').get('tool_calls'):
                    # Update choice_event_body for each tool call
                    choice_event_body["message"].update({
                        "tool_calls": {
                            "function": {
                                "name": tool_call.get('function', {}).get('name', ''),
                                "arguments": tool_call.get('function', {}).get('arguments', '')
                            },
                            "id": tool_call.get('id', ''),
                            "type": tool_call.get('type', 'function')
                        }
                    })

                    # Create and emit event for each tool call
                    choice_event = otel_event(
                        name=SemanticConvetion.GEN_AI_CHOICE,
                        attributes={
                            SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AI21
                        },
                        body=choice_event_body
                    )
                    event_provider.emit(choice_event)
            else:
                # Create and emit event for each tool call
                choice_event = otel_event(
                    name=SemanticConvetion.GEN_AI_CHOICE,
                    attributes={
                        SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AI21
                    },
                    body=choice_event_body
                )
                event_provider.emit(choice_event)
    else:
        # Access properties from the choice
        choice_event_body = {
            "finish_reason": scope._finish_reason,
            "index": 0,
            "message": {
                **({"content": scope._llmresponse} if capture_message_content else {}),
                "role": 'assistant'
            }
        }
        # Create and emit event for each tool call
        choice_event = otel_event(
            name=SemanticConvetion.GEN_AI_CHOICE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AI21
            },
            body=choice_event_body
        )
        event_provider.emit(choice_event)

    # Emit events
    for role in ['user', 'system', 'assistant', 'tool']:
        if formatted_messages.get(role, {}).get('content', ''):
            event = otel_event(
                name=getattr(SemanticConvetion, f'GEN_AI_{role.upper()}_MESSAGE'),
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AI21
                },
                body = {
                    # pylint: disable=line-too-long
                    **({"content": formatted_messages.get(role, {}).get('content', '')} if capture_message_content else {}),
                    "role": formatted_messages.get(role, {}).get('role', []),
                    **({
                        "tool_calls": {
                            "function": {
                                # pylint: disable=line-too-long
                                "name": (scope._choices[0].get('message', {}).get('tool_calls', [])[0].get('function', {}).get('name', '') if scope._choices[0].get('message', {}).get('tool_calls') else ''),
                                "arguments": (
                                    scope._choices[0].get('message', {}).get('tool_calls', [])[0].get('function', {}).get('arguments', '')
                                    if scope._choices[0].get('message', {}).get('tool_calls')
                                    else '' 
                                )                           
                            },
                            "id": (scope._choices[0].get('message', {}).get('tool_calls', [])[0].get('id', '') if scope._choices[0].get('message', {}).get('tool_calls') else ''),
                            "type": "function"
                        }
                    } if role == 'assistant' else {}),
                    **({
                        "id": (scope._choices[0].get('message', {}).get('tool_calls', [])[0].get('id', '') if scope._choices[0].get('message', {}).get('tool_calls') else ''),
                    } if role == 'tool' else {})
                }
            )
            event_provider.emit(event)

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        metrics_attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvetion.GEN_AI_SYSTEM_AI21,
            request_model=request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=request_model,
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
    self._llmresponse = ''.join(
        (choice.get('message', {}).get('content') or '') for choice in response.get('choices', [])
    )
    self._response_role = response.get('message', {}).get('role', 'assistant')
    self._input_tokens = response.get('usage', {}).get('prompt_tokens', 0)
    self._output_tokens = response.get('usage', {}).get('completion_tokens', 0)
    self._response_id = response.get('id', '')
    self._response_model = request_model
    self._finish_reason = response.get('choices', '')[0].get('finish_reason')
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    self._choices = response.get('choices')

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
                        event_provider, capture_message_content, disable_metrics, version, is_stream=False)

    return response

def process_chat_rag_response(response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, event_provider, start_time,
                          span, capture_message_content=False, disable_metrics=False, version="1.0.0", **kwargs):
    
    end_time = time.time()

    try:
        # Format 'messages' into a single string
        message_prompt = kwargs.get("messages", "")
        formatted_messages = []
        for message in message_prompt:
            role = message.role
            content = message.content

            if isinstance(content, list):
                content_str = ", ".join(
                    f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                    if "type" in item else f'text: {item["text"]}'
                    for item in content
                )
                formatted_messages.append(f"{role}: {content_str}")
            else:
                formatted_messages.append(f"{role}: {content}")
        prompt = "\n".join(formatted_messages)

        input_tokens = general_tokens(prompt)

        # Set base span attribues (OTel Semconv)
        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
        span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                            SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                            SemanticConvetion.GEN_AI_SYSTEM_AI21)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                            request_model)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                            kwargs.get("seed", ""))
        span.set_attribute(SemanticConvetion.SERVER_PORT,
                            server_port)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                            kwargs.get("frequency_penalty", 0.0))
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                            kwargs.get("max_tokens", -1))
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                            kwargs.get("presence_penalty", 0.0))
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES,
                            kwargs.get("stop", []))
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                            kwargs.get("temperature", 0.4))
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                            kwargs.get("top_p", 1.0))
        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                            response.get("id"))
        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                            request_model)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                            input_tokens)
        span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                            server_address)

        # Set base span attribues (Extras)
        span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                            environment)
        span.set_attribute(SERVICE_NAME,
                            application_name)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                            False)
        span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                            end_time - start_time)
        span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                            version)
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_SEGMENTS,
                            kwargs.get("max_segments", -1))
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_STRATEGY,
                            kwargs.get("retrieval_strategy", "segments"))
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_SIMILARITY_THRESHOLD,
                            kwargs.get("retrieval_similarity_threshold", -1))
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_NEIGHBORS,
                            kwargs.get("max_neighbors", -1))
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_FILE_IDS,
                            str(kwargs.get("file_ids", "")))
        span.set_attribute(SemanticConvetion.GEN_AI_RAG_DOCUMENTS_PATH,
                            kwargs.get("path", ""))
        if capture_message_content:
            span.add_event(
                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                attributes={
                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                },
            )

        output_tokens = 0
        for i in range(kwargs.get('n',1)):
            output_tokens += general_tokens(response.get('choices')[i].get('content'))

            if capture_message_content:
                span.add_event(
                    name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                    attributes={
                        # pylint: disable=line-too-long
                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: str(response.get('choices')[i].get('content')),
                    },
                )
            if kwargs.get('tools'):
                span.set_attribute(SemanticConvetion.GEN_AI_TOOL_CALLS,
                                str(response.get('choices')[i].get('message').get('tool_calls')))

            if isinstance(response.get('choices')[i].get('content'), str):
                span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                "text")
            elif response.get('choices')[i].get('content') is not None:
                span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                "json")

        # Calculate cost of the operation
        cost = get_chat_model_cost(request_model,
                                    pricing_info, input_tokens,
                                    output_tokens)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                            cost)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                            output_tokens)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                            input_tokens + output_tokens)

        span.set_status(Status(StatusCode.OK))

        if disable_metrics is False:
            attributes = create_metrics_attributes(
                service_name=application_name,
                deployment_environment=environment,
                operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
                system=SemanticConvetion.GEN_AI_SYSTEM_AI21,
                request_model=request_model,
                server_address=server_address,
                server_port=server_port,
                response_model=request_model,
            )

            metrics["genai_client_usage_tokens"].record(
                input_tokens + output_tokens, attributes
            )
            metrics["genai_client_operation_duration"].record(
                end_time - start_time, attributes
            )
            metrics["genai_server_ttft"].record(
                end_time - start_time, attributes
            )
            metrics["genai_requests"].add(1, attributes)
            metrics["genai_completion_tokens"].add(output_tokens, attributes)
            metrics["genai_prompt_tokens"].add(input_tokens, attributes)
            metrics["genai_cost"].record(cost, attributes)

        # Return original response
        return response

    except Exception as e:
        handle_exception(span, e)

        # Return original response
        return response