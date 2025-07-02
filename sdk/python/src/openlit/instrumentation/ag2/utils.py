"""
AG2 OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    get_chat_model_cost,
    common_span_attributes,
    record_completion_metrics,
)
from openlit.semcov import SemanticConvention

def calculate_tokens_and_cost(response, request_model, pricing_info):
    """
    Calculate the input, output tokens, and their respective costs from AG2 response.
    """
    input_tokens = 0
    output_tokens = 0

    # Early return if response doesn't have cost data
    if not hasattr(response, "cost") or response.cost is None:
        cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)
        return input_tokens, output_tokens, cost

    try:
        input_tokens, output_tokens = _extract_tokens_from_cost(response.cost)
    except (AttributeError, TypeError):
        # If theres any issue accessing cost data, default to 0 tokens
        input_tokens = 0
        output_tokens = 0

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)
    return input_tokens, output_tokens, cost

def _extract_tokens_from_cost(cost_data):
    """
    Extract input and output tokens from AG2 cost data structure.
    """
    input_tokens = 0
    output_tokens = 0

    for usage_data in cost_data.values():
        if not isinstance(usage_data, dict):
            continue

        for model_data in usage_data.values():
            if isinstance(model_data, dict):
                input_tokens += model_data.get("prompt_tokens", 0)
                output_tokens += model_data.get("completion_tokens", 0)

    return input_tokens, output_tokens

def format_content(chat_history):
    """
    Format the chat history into a string for span events.
    """
    if not chat_history:
        return ""

    formatted_messages = []
    for chat in chat_history:
        role = chat.get("role", "user")
        content = chat.get("content", "")
        formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)

def common_agent_logic(scope, pricing_info, environment, application_name, metrics,
    capture_message_content, disable_metrics, version, operation_type):
    """
    Process agent request and generate Telemetry
    """

    # Common Span Attributes
    common_span_attributes(scope,
        operation_type, SemanticConvention.GEN_AI_SYSTEM_AG2,
        scope._server_address, scope._server_port, scope._request_model, scope._response_model,
        environment, application_name, False, 0, scope._end_time - scope._start_time, version)

    # Span Attributes for Agent-specific parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, scope._agent_name)

    # Span Attributes for Response parameters
    if hasattr(scope, "_input_tokens"):
        scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens)
        scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens)
        scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens + scope._output_tokens)
        scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, scope._cost)

    # Span Attributes for Content
    if capture_message_content and hasattr(scope, "_chat_history"):
        chat_content = format_content(scope._chat_history)
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, chat_content)

        # To be removed once the change to span_attributes (from span events) is complete
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_COMPLETION: chat_content,
            },
        )

    # Set agent description for create agent operation
    if hasattr(scope, "_system_message"):
        scope._span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, scope._system_message)

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics and hasattr(scope, "_input_tokens"):
        record_completion_metrics(metrics, operation_type, SemanticConvention.GEN_AI_SYSTEM_AG2,
            scope._server_address, scope._server_port, scope._request_model, scope._response_model, environment,
            application_name, scope._start_time, scope._end_time, scope._input_tokens, scope._output_tokens,
            scope._cost, 0, scope._end_time - scope._start_time)

def process_agent_creation(agent_name, llm_config, system_message, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span, capture_message_content=False,
    disable_metrics=False, version="1.0.0", **kwargs):
    """
    Process agent creation and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._agent_name = agent_name
    scope._request_model = llm_config.get("model", "gpt-4o")
    scope._response_model = scope._request_model
    scope._system_message = system_message
    scope._server_address, scope._server_port = server_address, server_port

    common_agent_logic(scope, pricing_info, environment, application_name, metrics,
        capture_message_content, disable_metrics, version, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT)

def process_agent_run(response, agent_name, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span, capture_message_content=False,
    disable_metrics=False, version="1.0.0", **kwargs):
    """
    Process agent run and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._agent_name = agent_name
    scope._request_model = request_model
    scope._chat_history = getattr(response, "chat_history", [])
    scope._server_address, scope._server_port = server_address, server_port

    # Calculate tokens and cost
    scope._input_tokens, scope._output_tokens, scope._cost = calculate_tokens_and_cost(
        response, request_model, pricing_info)

    # Extract response model from cost data
    try:
        if hasattr(response, "cost") and response.cost is not None:
            cost_data = response.cost.get("usage_including_cached_inference", {})
            scope._response_model = list(cost_data.keys())[1] if len(cost_data) > 1 else request_model
        else:
            scope._response_model = request_model
    except (AttributeError, IndexError, KeyError, TypeError):
        scope._response_model = request_model

    common_agent_logic(scope, pricing_info, environment, application_name, metrics,
        capture_message_content, disable_metrics, version, SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK)

    return response
