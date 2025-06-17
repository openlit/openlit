"""
Utility functions for vLLM instrumentation.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    general_tokens,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

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
    scope._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                        SemanticConvention.GEN_AI_SYSTEM_VLLM)
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT,
                        scope._server_port)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                        scope._request_model)
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                        scope._request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                        scope._server_address)
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                        "text")

    # Set base span attributes (Extras)
    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                         environment)
    scope._span.set_attribute(SERVICE_NAME,
                        application_name)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                        is_stream)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                        scope._end_time - scope._start_time)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                        version)

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
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                        input_tokens + output_tokens)

    # Calculate cost of the operation
    cost = get_chat_model_cost(scope._request_model, pricing_info,
                                input_tokens, output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                        cost)

    scope._span.set_status(Status(StatusCode.OK))

    if disable_metrics is False:
        attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvention.GEN_AI_SYSTEM_VLLM,
            request_model=scope._request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=scope._request_model,
        )

        metrics["genai_client_usage_tokens"].record(
            input_tokens + output_tokens, attributes
        )
        metrics["genai_client_operation_duration"].record(
            scope._end_time - scope._start_time, attributes
        )
        metrics["genai_server_ttft"].record(
            scope._end_time - scope._start_time, attributes
        )
        metrics["genai_requests"].add(1, attributes)
        metrics["genai_completion_tokens"].add(output_tokens, attributes)
        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
        metrics["genai_cost"].record(cost, attributes)

def process_chat_response(instance, response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span, args, kwargs, 
    capture_message_content=False, disable_metrics=False, version="1.0.0"):
    """
    Process chat request and generate Telemetry
    """
    self = type('GenericScope', (), {})()
    self._response = response
    self._start_time = start_time
    self._span = span
    self._server_address = server_address
    self._server_port = server_port
    self._request_model = request_model
    self._timestamps = []

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
        capture_message_content, disable_metrics, version, is_stream=False)

    return response 