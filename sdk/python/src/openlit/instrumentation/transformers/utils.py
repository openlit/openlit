"""
HF Transformers OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    response_as_dict,
    calculate_tbt,
    general_tokens,
    get_chat_model_cost,
    create_metrics_attributes,
    format_and_concatenate
)
from openlit.semcov import SemanticConvention

def common_chat_logic(scope, pricing_info, environment, application_name, metrics,
    capture_message_content, disable_metrics, version, args, kwargs, is_stream):

    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    forward_params = scope._instance._forward_params
    request_model = scope._instance.model.config.name_or_path

    input_tokens = general_tokens(scope._prompt)
    output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Set Span attributes (OTel Semconv)
    scope._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    scope._span.set_attribute(SemanticConvention.SERVER_PORT, scope._server_port)

    # List of attributes and their config keys
    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_length"),
    ]

    # Set each attribute if the corresponding value exists and is not None
    for attribute, key in attributes:
        value = forward_params.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
    scope._span.set_attribute(SemanticConvention.SERVER_ADDRESS, scope._server_address)
    scope._span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    scope._span.set_attribute(SERVICE_NAME, application_name)
    scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, is_stream)
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens)
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT, scope._tbt)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, scope._ttft)
    scope._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

    # To be removed one the change to span_attributes (from span events) is complete
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, scope._prompt)
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, scope._llmresponse,)

        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_PROMPT: scope._prompt,
            },
        )
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_CONTENT_COMPLETION: scope._llmresponse,
            },
        )

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        metrics_attributes = create_metrics_attributes(
            service_name=application_name,
            deployment_environment=environment,
            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            system=SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
            request_model=request_model,
            server_address=scope._server_address,
            server_port=scope._server_port,
            response_model=request_model,
        )

        metrics["genai_client_usage_tokens"].record(input_tokens + output_tokens, metrics_attributes)
        metrics["genai_client_operation_duration"].record(scope._end_time - scope._start_time, metrics_attributes)
        metrics["genai_server_tbt"].record(scope._tbt, metrics_attributes)
        metrics["genai_server_ttft"].record(scope._ttft, metrics_attributes)
        metrics["genai_requests"].add(1, metrics_attributes)
        metrics["genai_completion_tokens"].add(output_tokens, metrics_attributes)
        metrics["genai_prompt_tokens"].add(input_tokens, metrics_attributes)
        metrics["genai_cost"].record(cost, metrics_attributes)

def process_chat_response(instance, response, request_model, pricing_info, server_port, server_address,
                          environment, application_name, metrics, start_time,
                          span, args, kwargs, capture_message_content=False, disable_metrics=False, version="1.0.0"):
    """
    Process chat request and generate Telemetry
    """

    self = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    # pylint: disable = no-member
    self._instance = instance
    self._start_time = start_time
    self._end_time = time.time()
    self._span = span
    self._timestamps = []
    self._ttft, self._tbt = self._end_time - self._start_time, 0
    self._server_address, self._server_port = server_address, server_port
    self._kwargs = kwargs
    self._args = args

    if self._args and len(self._args) > 0:
        self._prompt = args[0]
    else:
        self._prompt = (
            kwargs.get("text_inputs") or
            (kwargs.get("image") and kwargs.get("question") and
            ("image: " + kwargs.get("image") + " question:" + kwargs.get("question"))) or
            kwargs.get("fallback") or
            ""
        )
    self._prompt = format_and_concatenate(self._prompt)

    self._llmresponse = []
    if self._kwargs.get("task", "text-generation") == "text-generation":
        first_entry = response_dict[0]

        if isinstance(first_entry, dict) and isinstance(first_entry.get("generated_text"), list):
            last_element = first_entry.get("generated_text")[-1]
            self._llmresponse = last_element.get("content", last_element)
        else:
            def extract_text(entry):
                if isinstance(entry, dict):
                    return entry.get("generated_text")
                if isinstance(entry, list):
                    return " ".join(
                        extract_text(sub_entry) for sub_entry in entry if isinstance(sub_entry, dict)
                    )
                return ""

            # Process and collect all generated texts
            self._llmresponse = [
                extract_text(entry) for entry in response_dict
            ]

            # Join all non-empty responses into a single string
            self._llmresponse = " ".join(filter(None, self._llmresponse))

    elif self._kwargs.get("task", "text-generation") == "automatic-speech-recognition":
        self._llmresponse = response_dict.get("text", "")

    elif self._kwargs.get("task", "text-generation") == "image-classification":
        self._llmresponse = str(response_dict[0])

    elif self._kwargs.get("task", "text-generation") == "visual-question-answering":
        self._llmresponse = str(response_dict[0]).get("answer")

    common_chat_logic(self, pricing_info, environment, application_name, metrics,
            capture_message_content, disable_metrics, version, args, kwargs, is_stream=False)

    return response
