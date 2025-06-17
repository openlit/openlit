"""
Utility functions for vLLM instrumentation.
"""

import time
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode
from openlit.__helpers import (
    calculate_tbt,
    get_chat_model_cost,
    general_tokens,
    create_metrics_attributes,
)
from openlit.semcov import SemanticConvention

def get_inference_config(args, kwargs):
    """
    Safely extract inference configuration from args or kwargs.
    """

    if 'sampling_params' in kwargs:
        return kwargs['sampling_params']
    if len(args) > 1:
        return args[1]
    return None

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
    capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    # Set base span attributes
    scope._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_VLLM)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, scope._request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT, scope._server_port)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS, scope._server_address)

    # Handle inference configuration
    inference_config = get_inference_config(scope._args, scope._kwargs)
    if inference_config:
        attributes = [
            (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'frequency_penalty'),
            (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 'max_tokens'),
            (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 'presence_penalty'),
            (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop_sequences'),
            (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
            (SemanticConvention.GEN_AI_REQUEST_TOP_P, 'top_p'),
            (SemanticConvention.GEN_AI_REQUEST_TOP_K, 'top_k'),
        ]

        for attribute, key in attributes:
            value = getattr(inference_config, key, None)
            if value is not None:
                scope._span.set_attribute(attribute, value)

    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, scope._request_model)
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text")

    # Set base span attributes (Extras)
    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    scope._span.set_attribute(SERVICE_NAME, application_name)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, is_stream)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT, scope._tbt)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, scope._ttft)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

    input_tokens = 0
    output_tokens = 0
    cost = 0

    if capture_message_content:
        prompt = ""
        completion = ""

        for output in scope._response:
            prompt += output.prompt + "\n"
            if output.outputs and len(output.outputs) > 0:
                completion += output.outputs[0].text + "\n"
            input_tokens += general_tokens(output.prompt)
            output_tokens += general_tokens(output.outputs[0].text)

        # Add a single event for prompt
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
            },
        )

        # Add a single event for completion
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_COMPLETION: completion,
            },
        )

    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                        input_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                        output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
                        input_tokens + output_tokens)

    # Calculate cost of the operation
    cost = get_chat_model_cost(scope._request_model, pricing_info, input_tokens, output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    scope._span.set_status(Status(StatusCode.OK))

    if disable_metrics is False:
        metrics_attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvention.GEN_AI_SYSTEM_VLLM,
            request_model=scope._request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=scope._request_model,
        )
        metrics['genai_client_operation_duration'].record(scope._end_time - scope._start_time, metrics_attributes)
        metrics['genai_server_tbt'].record(scope._tbt, metrics_attributes)
        metrics['genai_server_ttft'].record(scope._ttft, metrics_attributes)
        metrics['genai_requests'].add(1, metrics_attributes)
        metrics['genai_completion_tokens'].add(output_tokens, metrics_attributes)
        metrics['genai_prompt_tokens'].add(input_tokens, metrics_attributes)
        metrics['genai_cost'].record(cost, metrics_attributes)
        metrics['genai_client_usage_tokens'].record(
            input_tokens + output_tokens, metrics_attributes)

def process_chat_response(instance, response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span, args, kwargs,
    capture_message_content=False, disable_metrics=False, version="1.0.0"):
    """
    Process chat request and generate Telemetry
    """
    self = type('GenericScope', (), {})()
    self._response = response
    self._start_time = start_time
    self._end_time = time.time()
    self._span = span
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address = server_address
    self._server_port = server_port
    self._request_model = request_model
    self._timestamps = []
    self._args = args
    self._kwargs = kwargs

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
        capture_message_content, disable_metrics, version, is_stream=False)

    return response
