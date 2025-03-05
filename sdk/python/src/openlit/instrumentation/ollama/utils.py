import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT, TELEMETRY_SDK_VERSION
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    extract_and_format_input,
    get_chat_model_cost,
    handle_exception,
    create_metrics_attributes,
    otel_event
)
from openlit.semcov import SemanticConvetion

def process_chunk(self, chunk):
    """
    Process a chunk of response data and update internal state.

    Parameters:
    - chunk: The chunk of response data to process.
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

def process_streaming_chat_response(self, pricing_info, environment, application_name, metrics, 
        event_provider, trace_content=False, disable_metrics=False, version=''):

    self._end_time = time.time()
    if len(self._timestamps) > 1:
        self._tbt = calculate_tbt(self._timestamps)

    # Extract messages and handle roles dynamically
    formatted_messages = extract_and_format_input(self._kwargs.get("messages", ""))

    request_model = self._kwargs.get("model", "gpt-4o")

    # Calculate cost of the operation
    cost = get_chat_model_cost(request_model,
                                pricing_info, self._input_tokens,
                                self._output_tokens)

    # Set Span attributes (OTel Semconv)
    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    self._span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                        SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
    self._span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                        SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                        request_model)
    self._span.set_attribute(SemanticConvetion.SERVER_PORT,
                        self._server_port)

    # List of attributes and their config keys
    attributes = [
        (SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'repeat_penalty'),
        (SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS, 'max_tokens'),
        (SemanticConvetion.GEN_AI_REQUEST_SEED, 'seed'),
        (SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop'),
        (SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
        (SemanticConvetion.GEN_AI_REQUEST_TOP_P, 'top_p'),
        (SemanticConvetion.GEN_AI_REQUEST_TOP_K, 'top_k'),
    ]

    # Safely get the options dictionary from kwargs
    options = self._kwargs.get('options', {})

    # Set each attribute if the corresponding value exists and is not None
    for attribute, key in attributes:
        # Use dictionary `get` to retrieve values from the options dictionary
        value = options.get(key)
        if value is not None:
            self._span.set_attribute(attribute, value)

    self._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                        [self._finish_reason])
    self._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                        self._response_model)
    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                        self._input_tokens)
    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                        self._output_tokens)
    self._span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                        self._server_address)
    if isinstance(self._llmresponse, str):
        self._span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                        "text")
    else:
        self._span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                        "json")

    # Set Span attributes (Extra)
    self._span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                        environment)
    self._span.set_attribute(SERVICE_NAME,
                        application_name)
    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                        True)
    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                        self._input_tokens + self._output_tokens)
    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                        cost)
    self._span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TBT,
                        self._tbt)
    self._span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                        self._ttft)
    self._span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                        version)

    choice_event_body = {
        "finish_reason": self._finish_reason,
        "index": 0,
        "message": {
            **({"content": self._llmresponse} if trace_content else {}),
            "role": self._response_role
        }
    }

    if self._tool_calls != []:
        function_call = self._tool_calls[0]
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
    if formatted_messages.get('user', {}).get('content', ''):
        prompt_event = otel_event(
            name=SemanticConvetion.GEN_AI_USER_MESSAGE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
            },
            body={
                **({"content": formatted_messages.get('user', {}).get('content', '')} if trace_content else {}),
                "role":  formatted_messages.get('user', {}).get('role', [])
            }
        )
        event_provider.emit(prompt_event)

    if formatted_messages.get('system', {}).get('content', ''):
        system_event = otel_event(
            name=SemanticConvetion.GEN_AI_SYSTEM_MESSAGE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
            },
            body={
                **({"content": formatted_messages.get('system', {}).get('content', '')} if trace_content else {}),
                "role":  formatted_messages.get('system', {}).get('role', [])
            }
        )
        event_provider.emit(system_event)

    if formatted_messages.get('assistant', {}).get('content', ''):
        assistant_event = otel_event(
            name=SemanticConvetion.GEN_AI_ASSISTANT_MESSAGE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
            },
            body={
                **({"content": formatted_messages.get('assistant', {}).get('content', '')} if trace_content else {}),
                "role":  formatted_messages.get('assistant', {}).get('role', [])
            }
        )
        event_provider.emit(assistant_event)
    
    if formatted_messages.get('tool', {}).get('content', ''):
        tools_event = otel_event(
            name=SemanticConvetion.GEN_AI_ASSISTANT_MESSAGE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
            },
            body={
                **({"content": formatted_messages.get('assistant', {}).get('content', '')} if trace_content else {}),
                "role":  formatted_messages.get('assistant', {}).get('role', [])
            }
        )
        event_provider.emit(tools_event)
    
    choice_event = otel_event(
        name=SemanticConvetion.GEN_AI_CHOICE,
            attributes={
                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
            },
            body=choice_event_body
    )
    event_provider.emit(choice_event)
    
    self._span.set_status(Status(StatusCode.OK))

    if disable_metrics is False:
        attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
            request_model=request_model,
            server_address=self._server_address,
            server_port=self._server_port,
            response_model=self._response_model,
        )

        metrics["genai_client_usage_tokens"].record(
            self._input_tokens + self._output_tokens, attributes
        )
        metrics["genai_client_operation_duration"].record(
            self._end_time - self._start_time, attributes
        )
        metrics["genai_server_tbt"].record(
            self._tbt, attributes
        )
        metrics["genai_server_ttft"].record(
            self._ttft, attributes
        )
        metrics["genai_requests"].add(1, attributes)
        metrics["genai_completion_tokens"].add(self._output_tokens, attributes)
        metrics["genai_prompt_tokens"].add(self._input_tokens, attributes)
        metrics["genai_cost"].record(cost, attributes)

def process_chat_response(response, request_model, pricing_info, server_port, server_address,
                     environment, application_name, metrics, event_provider,
                     start_time, span, trace_content=False, disable_metrics=False, version="1.0.0", **kwargs):
    end_time = time.time()

    response_dict = response_as_dict(response)

    try:
        # Extract messages and handle roles dynamically
        formatted_messages = extract_and_format_input(kwargs.get("messages", ""))

        input_tokens = response_dict.get('prompt_eval_count')
        output_tokens = response_dict.get('eval_count')

        # Calculate cost of the operation
        cost = get_chat_model_cost(request_model,
                                    pricing_info, input_tokens,
                                    output_tokens)

        # Set base span attribues (OTel Semconv)
        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
        span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                            SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                            SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                            request_model)
        span.set_attribute(SemanticConvetion.SERVER_PORT,
                            server_port)

        # List of attributes and their config keys
        attributes = [
            (SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'repeat_penalty'),
            (SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS, 'max_tokens'),
            (SemanticConvetion.GEN_AI_REQUEST_SEED, 'seed'),
            (SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop'),
            (SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
            (SemanticConvetion.GEN_AI_REQUEST_TOP_P, 'top_p'),
            (SemanticConvetion.GEN_AI_REQUEST_TOP_K, 'top_k'),
        ]

        # Safely get the options dictionary from kwargs
        options = kwargs.get('options', {})

        # Set each attribute if the corresponding value exists and is not None
        for attribute, key in attributes:
            # Use dictionary `get` to retrieve values from the options dictionary
            value = options.get(key)
            if value is not None:
                span.set_attribute(attribute, value)

        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                            response_dict.get('model'))
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                            input_tokens)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                            output_tokens)
        span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                            server_address)
        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                [response_dict.get('done_reason')])
        if kwargs.get('format'):
            span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                'json')
        else:
            span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                'text')

        # Set base span attribues (Extras)
        span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                            environment)
        span.set_attribute(SERVICE_NAME,
                            application_name)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                            False)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                            input_tokens + output_tokens)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                            cost)
        span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                            end_time - start_time)
        span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                            version)

        choice_event_body = {
            "finish_reason": response_dict.get('done_reason'),
            "index": 0,
            "message": {
                **({"content": response_dict.get('message', {}).get('content', '')} if trace_content else {}),
                "role": response_dict.get('message', {}).get('role', 'assistant')
            }
        }

        # Check for tool calls and construct additional details if they exist
        tool_calls = response_dict.get('message', {}).get('tool_calls')
        if tool_calls:
            function_call = tool_calls[0]  # Assuming you want the first function call
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

        if formatted_messages.get('user', {}).get('content', ''):
            prompt_event = otel_event(
                name=SemanticConvetion.GEN_AI_USER_MESSAGE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body={
                    **({"content": formatted_messages.get('user', {}).get('content', '')} if trace_content else {}),
                    "role":  formatted_messages.get('user', {}).get('role', [])
                }
            )
            event_provider.emit(prompt_event)

        if formatted_messages.get('system', {}).get('content', ''):
            system_event = otel_event(
                name=SemanticConvetion.GEN_AI_SYSTEM_MESSAGE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body={
                    **({"content": formatted_messages.get('system', {}).get('content', '')} if trace_content else {}),
                    "role":  formatted_messages.get('system', {}).get('role', [])
                }
            )
            event_provider.emit(system_event)

        if formatted_messages.get('assistant', {}).get('content', ''):
            assistant_event = otel_event(
                name=SemanticConvetion.GEN_AI_ASSISTANT_MESSAGE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body={
                    **({"content": formatted_messages.get('assistant', {}).get('content', '')} if trace_content else {}),
                    "role":  formatted_messages.get('assistant', {}).get('role', [])
                }
            )
            event_provider.emit(assistant_event)
        
        if formatted_messages.get('tool', {}).get('content', ''):
            tools_event = otel_event(
                name=SemanticConvetion.GEN_AI_ASSISTANT_MESSAGE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body={
                    **({"content": formatted_messages.get('assistant', {}).get('content', '')} if trace_content else {}),
                    "role":  formatted_messages.get('assistant', {}).get('role', [])
                }
            )
            event_provider.emit(tools_event)

        choice_event = otel_event(
            name=SemanticConvetion.GEN_AI_CHOICE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body=choice_event_body
        )
        event_provider.emit(choice_event)

        span.set_status(Status(StatusCode.OK))

        if disable_metrics is False:
            attributes = create_metrics_attributes(
                service_name=application_name,
                deployment_environment=environment,
                operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
                system=SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                request_model=request_model,
                server_address=server_address,
                server_port=server_port,
                response_model=response_dict.get('model'),
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
        logger.error("Error in trace creation: %s", e)

        # Return original response
        return response


def process_embedding_response(response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, event_provider,
    start_time, span, trace_content=False, disable_metrics=False, version="1.0.0", **kwargs):

    end_time = time.time()

    try:
        input_tokens = general_tokens(str(kwargs.get('prompt')))

        # Calculate cost of the operation
        cost = get_embed_model_cost(request_model,
                            pricing_info, input_tokens)

        # Set Span attributes (OTel Semconv)
        span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
        span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                            SemanticConvetion.GEN_AI_OPERATION_TYPE_EMBEDDING)
        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                            SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                            request_model)
        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                            request_model)
        span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                            server_address)
        span.set_attribute(SemanticConvetion.SERVER_PORT,
                            server_port)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                            input_tokens)

        # Set Span attributes (Extras)
        span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                            environment)
        span.set_attribute(SERVICE_NAME,
                            application_name)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                            input_tokens)
        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                            cost)
        span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                            version)

        if formatted_messages.get('user', {}).get('content', ''):
            prompt_event = otel_event(
                name=SemanticConvetion.GEN_AI_USER_MESSAGE,
                attributes={
                    SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_OLLAMA
                },
                body={
                    **({"content": kwargs.get('prompt', '')} if trace_content else {}),
                    "role":  formatted_messages.get('user', {}).get('role', [])
                }
            )
            event_provider.emit(prompt_event)

        span.set_status(Status(StatusCode.OK))

        if disable_metrics is False:
            attributes = create_metrics_attributes(
                service_name=application_name,
                deployment_environment=environment,
                operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_EMBEDDING,
                system=SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
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
        logger.error('Error in trace creation: %s', e)

        # Return original response
        return response