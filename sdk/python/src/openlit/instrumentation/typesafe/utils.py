"""TypeSafe System One OpenTelemetry instrumentation utilities."""

import json
import time
from urllib.parse import urlparse

from opentelemetry.sdk.resources import (
    DEPLOYMENT_ENVIRONMENT,
    SERVICE_NAME,
    TELEMETRY_SDK_NAME,
)
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    _apply_custom_span_attributes,
    common_span_attributes,
    get_chat_model_cost,
    handle_exception,
    otel_event,
    record_completion_metrics,
    response_as_dict,
    set_server_address_and_port,
)
from openlit._config import OpenlitConfig
from openlit.semcov import SemanticConvention

DEFAULT_SERVER_ADDRESS = "api.typesafe.ai"
DEFAULT_SERVER_PORT = 443
DEFAULT_MODEL = "jev-latest"


def server_address_and_port(instance):
    """Resolve TypeSafe host/port from the client, defaulting to api.typesafe.ai:443."""
    address, port = set_server_address_and_port(
        instance, DEFAULT_SERVER_ADDRESS, DEFAULT_SERVER_PORT
    )
    if address != DEFAULT_SERVER_ADDRESS:
        return address, port

    base = (
        getattr(instance, "base_url", None)
        or getattr(instance, "baseURL", None)
        or getattr(getattr(instance, "_config", None), "base_url", None)
    )
    if not base:
        return address, port
    if hasattr(base, "host"):
        host = getattr(base, "host", None) or DEFAULT_SERVER_ADDRESS
        port_attr = getattr(base, "port", None)
        return host, port_attr if port_attr is not None else DEFAULT_SERVER_PORT
    parsed = urlparse(str(base))
    if parsed.hostname:
        return parsed.hostname, parsed.port or DEFAULT_SERVER_PORT
    return address, port


def extract_request(instance, args, kwargs):
    """Pull state, questions, and model from positional or keyword System One args."""
    state = args[0] if args else kwargs.get("state")
    questions = args[1] if len(args) > 1 else kwargs.get("questions") or {}
    model = (
        kwargs.get("model")
        or getattr(instance, "default_model", None)
        or getattr(instance, "defaultModel", None)
        or getattr(getattr(instance, "_config", None), "default_model", None)
        or DEFAULT_MODEL
    )
    return state, questions, model


def _question_type(question):
    if isinstance(question, dict):
        return str(question.get("type") or "")
    q_type = getattr(question, "type", None)
    if q_type:
        return str(q_type)
    name = type(question).__name__.lower()
    if name in ("noul", "choice", "score"):
        return name
    return ""


def question_metadata(questions):
    """Return question count plus comma-joined ids and types for span attributes."""
    if not isinstance(questions, dict):
        return 0, "", ""
    ids = [str(key) for key in questions.keys()]
    types = [_question_type(questions[key]) or "unknown" for key in questions.keys()]
    return len(ids), ",".join(ids), ",".join(types)


def _jsonable(value):
    parsed = response_as_dict(value)
    if parsed is value and not isinstance(value, (dict, list, str, int, float, bool, type(None))):
        try:
            return json.loads(json.dumps(value, default=str))
        except Exception:
            return str(value)
    return parsed


def _field(obj, name, default=None):
    """Read a dict key or attribute without raising on SDK property accessors."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    try:
        return getattr(obj, name, default)
    except Exception:
        return default


def _as_mapping(obj):
    if obj is None:
        return {}
    parsed = response_as_dict(obj)
    if isinstance(parsed, dict):
        return parsed
    mapping = {}
    for key in (
        "model",
        "usage",
        "answers",
        "request_id",
        "input_tokens",
        "output_tokens",
    ):
        value = _field(obj, key)
        if value is not None:
            mapping[key] = value
    return mapping


def set_request_span_attributes(
    span,
    request_model,
    server_address,
    server_port,
    environment,
    application_name,
    version,
    question_count,
    question_ids,
    question_types,
):
    """Five sampling attributes plus TypeSafe request metadata at span start."""
    attributes = {
        TELEMETRY_SDK_NAME: "openlit",
        SemanticConvention.GEN_AI_OPERATION: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
        SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
        SemanticConvention.SERVER_ADDRESS: server_address,
        SemanticConvention.SERVER_PORT: server_port,
        SemanticConvention.GEN_AI_REQUEST_MODEL: request_model,
        DEPLOYMENT_ENVIRONMENT: environment,
        SERVICE_NAME: application_name,
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM: False,
        SemanticConvention.GEN_AI_SDK_VERSION: version,
        SemanticConvention.TYPESAFE_API_TYPE: "system_one",
        SemanticConvention.TYPESAFE_QUESTION_COUNT: question_count,
        SemanticConvention.TYPESAFE_QUESTION_IDS: question_ids,
        SemanticConvention.TYPESAFE_QUESTION_TYPES: question_types,
    }
    for key, value in attributes.items():
        if value is not None:
            span.set_attribute(key, value)
    _apply_custom_span_attributes(span)


def process_system_one_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    event_provider,
    state,
    questions,
):
    """Set response attributes, optional message bodies, inference event, and metrics."""
    response_dict = _as_mapping(response)
    usage = _as_mapping(_field(response_dict, "usage") or _field(response, "usage"))

    response_model = _field(response_dict, "model") or _field(response, "model") or request_model
    request_id = (
        _field(response, "request_id")
        or _field(response_dict, "request_id")
        or _field(response, "id")
        or _field(response_dict, "id")
    )
    answers = _field(response_dict, "answers")
    if answers is None:
        answers = _field(response, "answers")

    input_tokens = _field(usage, "input_tokens")
    output_tokens = _field(usage, "output_tokens")
    end_time = time.time()

    # Same OpenLIT inference defaults as OpenAI chat (ttft, tbt=0, stream=false).
    scope = type("GenericScope", (), {})()
    scope._span = span
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
        SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
        server_address,
        server_port,
        request_model,
        response_model,
        environment,
        application_name,
        False,
        0,
        end_time - start_time,
        version,
    )
    span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "json")
    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ["stop"])
    span.set_attribute(SemanticConvention.TYPESAFE_API_TYPE, "system_one")
    question_count, question_ids, question_types = question_metadata(questions)
    span.set_attribute(SemanticConvention.TYPESAFE_QUESTION_COUNT, question_count)
    span.set_attribute(SemanticConvention.TYPESAFE_QUESTION_IDS, question_ids)
    span.set_attribute(SemanticConvention.TYPESAFE_QUESTION_TYPES, question_types)
    if request_id:
        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, request_id)

    if input_tokens is not None:
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
    if output_tokens is not None:
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
    if input_tokens is not None or output_tokens is not None:
        span.set_attribute(
            SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
            (input_tokens or 0) + (output_tokens or 0),
        )

    cost = 0
    if input_tokens is not None or output_tokens is not None:
        cost = get_chat_model_cost(
            request_model,
            pricing_info,
            input_tokens or 0,
            output_tokens or 0,
        )
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    input_messages = [
        {
            "role": "user",
            "parts": [
                {
                    "type": "text",
                    "content": json.dumps(
                        {"state": _jsonable(state), "questions": _jsonable(questions)},
                        default=str,
                    ),
                }
            ],
        }
    ]
    output_messages = [
        {
            "role": "assistant",
            "parts": [
                {
                    "type": "text",
                    "content": json.dumps(_jsonable(answers), default=str),
                }
            ],
            "finish_reason": "stop",
        }
    ]

    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(input_messages)
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(output_messages)
        )

    if event_provider and not OpenlitConfig.disable_events:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
            SemanticConvention.GEN_AI_REQUEST_MODEL: request_model,
            SemanticConvention.GEN_AI_RESPONSE_MODEL: response_model,
            SemanticConvention.SERVER_ADDRESS: server_address,
            SemanticConvention.SERVER_PORT: server_port,
            SemanticConvention.GEN_AI_OUTPUT_TYPE: "json",
        }
        if request_id:
            attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = request_id
        if input_tokens is not None:
            attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = input_tokens
        if output_tokens is not None:
            attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = output_tokens
        if capture_message_content:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        event_provider.emit(
            otel_event(
                name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
                attributes=attributes,
                body="",
            )
        )

    span.set_status(Status(StatusCode.OK))

    if not disable_metrics and metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
            SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
            server_address,
            server_port,
            request_model,
            response_model,
            environment,
            application_name,
            start_time,
            time.time(),
            input_tokens or 0,
            output_tokens or 0,
            cost,
            None,
            None,
        )

    return response


def record_error_metrics(
    metrics,
    disable_metrics,
    server_address,
    server_port,
    request_model,
    environment,
    application_name,
    start_time,
    error,
):
    """Record operation-duration metrics with error.type when the call fails."""
    if disable_metrics or not metrics:
        return
    record_completion_metrics(
        metrics,
        SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
        SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
        server_address,
        server_port,
        request_model,
        "unknown",
        environment,
        application_name,
        start_time,
        time.time(),
        0,
        0,
        0,
        None,
        None,
        error_type=type(error).__name__ or "_OTHER",
    )


# Re-export handle_exception for wrappers
__all__ = [
    "DEFAULT_MODEL",
    "extract_request",
    "handle_exception",
    "process_system_one_response",
    "question_metadata",
    "record_error_metrics",
    "server_address_and_port",
    "set_request_span_attributes",
]
