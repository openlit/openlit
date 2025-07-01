"""
LangChain OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    get_chat_model_cost,
    general_tokens,
    record_completion_metrics,
    common_span_attributes,
)
from openlit.semcov import SemanticConvention

def format_content(messages):
    """
    Format the messages into a string for span events.
    """

    if not messages:
        return ""

    # Handle string input (simple case)
    if isinstance(messages, str):
        return messages

    # Handle list of messages
    formatted_messages = []
    for message in messages:
        # Handle the case where message is a tuple
        if isinstance(message, tuple) and len(message) == 2:
            role, content = message
        # Handle the case where message is a dictionary
        elif isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", "")
        else:
            continue

        # Check if the content is a list
        if isinstance(content, list):
            content_str = ", ".join(
                f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                if "type" in item else f'text: {item["text"]}'
                for item in content
            )
            formatted_messages.append(f"{role}: {content_str}")
        else:
            formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)

def get_model_from_instance(instance):
    """
    Extract model name from LangChain instance.
    """
    if hasattr(instance, "model_id"):
        return instance.model_id
    elif hasattr(instance, "model"):
        return instance.model
    elif hasattr(instance, "model_name"):
        return instance.model_name
    else:
        return "langchain-model"

def get_attribute_from_instance(instance, attribute_name, default=-1):
    """
    Get attribute from instance, checking model_kwargs first.
    """
    # Attempt to retrieve model_kwargs from the instance
    model_kwargs = getattr(instance, "model_kwargs", None)

    # Check for attribute in model_kwargs if it exists
    if model_kwargs and attribute_name in model_kwargs:
        value = model_kwargs[attribute_name]
        return value if value is not None else default

    # Attempt to get the attribute directly from the instance
    try:
        value = getattr(instance, attribute_name)
        # Return default if value is None
        return value if value is not None else default
    except AttributeError:
        # Special handling for "model" attribute to consider "model_id"
        if attribute_name == "model":
            return getattr(instance, "model_id", "langchain-model")

        # Default if the attribute isnt found in model_kwargs or the instance
        return default

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                      capture_message_content, disable_metrics, version, is_stream):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    scope._tbt = 0  # LangChain doesnt support streaming yet
    scope._ttft = scope._end_time - scope._start_time

    # Extract prompt - check args[0] first (positional), then kwargs (keyword arguments)
    messages = None
    if scope._args and len(scope._args) > 0:
        messages = scope._args[0]  # llm.invoke([("system", "..."), ("human", "...")])
    else:
        messages = scope._kwargs.get("messages", "") or scope._kwargs.get("input", "")  # llm.invoke(messages=[...])

    formatted_messages = format_content(messages)
    request_model = scope._request_model

    # Use actual token counts from response if available, otherwise calculate them using general_tokens
    if (scope._input_tokens in [None, 0] or scope._output_tokens in [None, 0]):
        scope._input_tokens = general_tokens(str(formatted_messages))
        scope._output_tokens = general_tokens(str(scope._llmresponse))

    cost = get_chat_model_cost(request_model, pricing_info, scope._input_tokens, scope._output_tokens)

    # Common Span Attributes
    common_span_attributes(scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
        scope._server_address, scope._server_port, request_model, scope._response_model,
        environment, application_name, is_stream, scope._tbt, scope._ttft, version)

    # Span Attributes for Request parameters
    instance = scope._kwargs.get("instance")
    if instance:
        scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                 get_attribute_from_instance(instance, "temperature", 1.0))
        scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K,
                                 get_attribute_from_instance(instance, "top_k", 1.0))
        scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                 get_attribute_from_instance(instance, "top_p", 1.0))

    # Span Attributes for Response parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason])
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text" if isinstance(scope._llmresponse, str) else "json")

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens + scope._output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, formatted_messages)
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, scope._llmresponse)

        # To be removed once the change to span_attributes (from span events) is complete
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_PROMPT: formatted_messages,
            },
        )
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_COMPLETION: scope._llmresponse,
            },
        )

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(metrics, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            scope._server_address, scope._server_port, request_model, scope._response_model, environment,
            application_name, scope._start_time, scope._end_time, scope._input_tokens, scope._output_tokens,
            cost, scope._tbt, scope._ttft)

def process_chat_response(response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, start_time, end_time,
                          span, capture_message_content=False, disable_metrics=False,
                          version="1.0.0", args=None, **kwargs):
    """
    Process chat response and generate telemetry.
    """

    # Create scope object
    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = end_time
    scope._span = span
    scope._server_address = server_address
    scope._server_port = server_port
    scope._request_model = request_model
    scope._kwargs = kwargs
    scope._args = args or ()

    # Extract response content and metadata - only extract what comes from the response
    try:
        scope._llmresponse = response.content
    except AttributeError:
        scope._llmresponse = str(response)

    # Extract token information from usage_metadata if available
    usage_metadata = getattr(response, "usage_metadata", None)
    if usage_metadata:
        scope._input_tokens = usage_metadata.get("input_tokens", 0)
        scope._output_tokens = usage_metadata.get("output_tokens", 0)
        scope._total_tokens = usage_metadata.get("total_tokens", 0)
    else:
        # Will be calculated in common_chat_logic if not available
        scope._input_tokens = None
        scope._output_tokens = None
        scope._total_tokens = None

    # Extract response metadata
    response_metadata = getattr(response, "response_metadata", {})
    scope._response_model = response_metadata.get("model_name", request_model)
    scope._finish_reason = response_metadata.get("finish_reason", "stop")

    # Extract response ID
    scope._response_id = getattr(response, "id", "")

    common_chat_logic(scope, pricing_info, environment, application_name, metrics,
                        capture_message_content, disable_metrics, version, is_stream=False)

    return response



def process_hub_response(response, gen_ai_endpoint, server_port, server_address,
                        environment, application_name, span, version="1.0.0"):
    """
    Process LangChain hub operations and generate telemetry.
    """

    # Set span attributes for hub operations
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN)
    span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT, gen_ai_endpoint)
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
    span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
    span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)

    # Try to extract hub metadata
    try:
        span.set_attribute(SemanticConvention.GEN_AI_HUB_OWNER,
                          response.metadata.get("lc_hub_owner", "unknown"))
        span.set_attribute(SemanticConvention.GEN_AI_HUB_REPO,
                          response.metadata.get("lc_hub_repo", "unknown"))
    except (AttributeError, KeyError):
        pass

    span.set_status(Status(StatusCode.OK))

    return response
