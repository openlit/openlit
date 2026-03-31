"""Strands Agents instrumentation utilities.

Provides model-to-provider mapping, server address inference, content
extraction from Strands native span events, and metrics recording.
"""

import json
import logging

from openlit.__helpers import (
    get_server_address_for_provider,
    otel_event,
    truncate_content,
    truncate_message_content,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

# -------------------------------------------------------------------------
# Model prefix → provider mapping (used to infer server address / port)
# -------------------------------------------------------------------------
_MODEL_PREFIX_TO_PROVIDER = {
    "anthropic.": "aws.bedrock",
    "amazon.": "aws.bedrock",
    "meta.": "aws.bedrock",
    "us.anthropic.": "aws.bedrock",
    "us.amazon.": "aws.bedrock",
    "us.meta.": "aws.bedrock",
    "eu.anthropic.": "aws.bedrock",
    "eu.amazon.": "aws.bedrock",
    "eu.meta.": "aws.bedrock",
    "gpt-": "openai",
    "o1": "openai",
    "o3": "openai",
    "o4": "openai",
    "claude": "anthropic",
    "gemini": "google",
    "mistral": "mistral_ai",
    "command": "cohere",
    "deepseek": "deepseek",
}


def infer_server_address(model_name):
    """Return ``(server_address, server_port)`` inferred from *model_name*."""
    if not model_name:
        return "", 0
    lower = str(model_name).lower()
    for prefix, provider in _MODEL_PREFIX_TO_PROVIDER.items():
        if lower.startswith(prefix):
            return get_server_address_for_provider(provider)
    return "", 0


def infer_provider_name(model_name):
    """Return a provider name (e.g. ``"openai"``) inferred from *model_name*."""
    if not model_name:
        return ""
    lower = str(model_name).lower()
    for prefix, provider in _MODEL_PREFIX_TO_PROVIDER.items():
        if lower.startswith(prefix):
            return provider
    return ""


# -------------------------------------------------------------------------
# Content extraction from Strands span events
# -------------------------------------------------------------------------


def _safe_json_loads(value):
    """Parse *value* as JSON if it is a string, otherwise return as-is."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _convert_strands_content_to_parts(content):
    """Convert Strands Bedrock-style content blocks to OTel message parts."""
    blocks = _safe_json_loads(content)
    if not isinstance(blocks, list):
        blocks = [blocks] if blocks else []

    parts = []
    for block in blocks:
        if isinstance(block, dict):
            if "text" in block:
                parts.append({"type": "text", "content": block["text"]})
            elif "toolUse" in block:
                tu = block["toolUse"]
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tu.get("toolUseId", ""),
                        "name": tu.get("name", ""),
                        "arguments": tu.get("input", {}),
                    }
                )
            elif "toolResult" in block:
                tr = block["toolResult"]
                parts.append(
                    {
                        "type": "tool_call_response",
                        "id": tr.get("toolUseId", ""),
                        "response": tr.get("content", ""),
                    }
                )
            else:
                for key, value in block.items():
                    parts.append({"type": key, "content": value})
        elif isinstance(block, str):
            parts.append({"type": "text", "content": block})

    return parts or [{"type": "text", "content": str(content)}]


def extract_content_from_events(span, operation):
    """Extract message content from Strands span events.

    Handles both *legacy* (named events like ``gen_ai.user.message``) and
    *latest experimental* (``gen_ai.client.inference.operation.details``)
    convention modes.

    Returns:
        tuple: ``(input_messages, output_messages, system_instructions)``
               where each messages list follows the OTel structured format
               and *system_instructions* is a string or ``None``.
    """
    input_msgs = []
    output_msgs = []
    system_instructions = None

    for event in span.events or []:
        event_attrs = event.attributes or {}

        if event.name == "gen_ai.client.inference.operation.details":
            if "gen_ai.input.messages" in event_attrs:
                raw = _safe_json_loads(event_attrs["gen_ai.input.messages"])
                if isinstance(raw, list):
                    input_msgs = raw
                else:
                    input_msgs = [raw] if raw else []
            if "gen_ai.output.messages" in event_attrs:
                raw = _safe_json_loads(event_attrs["gen_ai.output.messages"])
                if isinstance(raw, list):
                    output_msgs = raw
                else:
                    output_msgs = [raw] if raw else []
            if "gen_ai.system_instructions" in event_attrs:
                system_instructions = event_attrs["gen_ai.system_instructions"]
            continue

        if event.name == "gen_ai.system.message":
            content = event_attrs.get("content", "")
            system_instructions = content
        elif event.name == "gen_ai.user.message":
            content = event_attrs.get("content", "")
            parts = _convert_strands_content_to_parts(content)
            input_msgs.append({"role": "user", "parts": parts})
        elif event.name == "gen_ai.assistant.message":
            content = event_attrs.get("content", "")
            parts = _convert_strands_content_to_parts(content)
            input_msgs.append({"role": "assistant", "parts": parts})
        elif event.name == "gen_ai.tool.message":
            content = event_attrs.get("content", "")
            tool_id = event_attrs.get("id", "")
            if operation == "execute_tool":
                input_msgs.append(
                    {
                        "role": "tool",
                        "parts": [
                            {
                                "type": "tool_call",
                                "id": tool_id,
                                "name": "",
                                "arguments": _safe_json_loads(content),
                            }
                        ],
                    }
                )
            else:
                input_msgs.append(
                    {
                        "role": "tool",
                        "parts": [
                            {
                                "type": "tool_call_response",
                                "id": tool_id,
                                "response": _safe_json_loads(content),
                            }
                        ],
                    }
                )
        elif event.name == "gen_ai.choice":
            message = event_attrs.get("message", "")
            finish_reason = event_attrs.get("finish_reason", "")
            if operation == "execute_tool":
                output_msgs.append(
                    {
                        "role": "tool",
                        "parts": _convert_strands_content_to_parts(message),
                    }
                )
            else:
                parts = _convert_strands_content_to_parts(message)
                entry = {"role": "assistant", "parts": parts}
                if finish_reason:
                    entry["finish_reason"] = str(finish_reason)
                output_msgs.append(entry)

    return input_msgs, output_msgs, system_instructions


# -------------------------------------------------------------------------
# Inference log event emission (matching OpenAI pattern)
# -------------------------------------------------------------------------


def emit_strands_inference_event(
    event_provider,
    operation_name,
    request_model,
    input_messages=None,
    output_messages=None,
    server_address=None,
    server_port=None,
    **extra_attrs,
):
    """Emit ``gen_ai.client.inference.operation.details`` log event.

    Mirrors :func:`openlit.instrumentation.openai.utils.emit_inference_event`
    so that chat telemetry from Strands is identical to OpenAI in
    observability backends.
    """
    try:
        if not event_provider:
            return

        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_name,
        }

        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model

        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        for key, value in extra_attrs.items():
            if value is None:
                continue
            if key == "response_id":
                attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
            elif key == "finish_reasons":
                attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
            elif key == "input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
            elif key == "output_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
            elif key == "cache_creation_input_tokens":
                attributes[
                    SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                ] = value
            elif key == "cache_read_input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = (
                    value
                )
            elif key == "system_instructions":
                attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
            elif key == "tool_definitions":
                attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = value
            else:
                attributes[key] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit Strands inference event: %s", e, exc_info=True)


# -------------------------------------------------------------------------
# Metrics recording
# -------------------------------------------------------------------------


def record_strands_metrics(
    metrics,
    operation,
    duration,
    environment,
    application_name,
    model,
    server_address,
    server_port,
):
    """Record ``gen_ai.client.operation.duration`` histogram."""
    try:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation,
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_STRANDS,
            "service.name": application_name,
            "deployment.environment": environment,
        }
        if model and model != "unknown":
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        if "genai_client_operation_duration" in metrics:
            metrics["genai_client_operation_duration"].record(duration, attributes)
    except Exception:
        pass
