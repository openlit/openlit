"""Strands Agents SpanProcessor.

Enriches Strands' native OTel spans with OpenLIT-specific attributes,
extracts content from span events into span attributes, emits
``gen_ai.client.inference.operation.details`` log events for ``chat``
spans (matching the OpenAI instrumentation pattern), and records
OpenLIT metrics.

Provider-level chat spans (OpenAI, Anthropic, etc.) are suppressed
when they occur inside a Strands ``chat`` span via the shared
``_framework_llm_span_active`` ContextVar.
"""

import json
import logging
import threading
import types

from opentelemetry.sdk.resources import (
    SERVICE_NAME,
    TELEMETRY_SDK_NAME,
    DEPLOYMENT_ENVIRONMENT,
)
from opentelemetry.sdk.trace import SpanProcessor

from openlit.__helpers import (
    get_chat_model_cost,
    set_framework_llm_active,
    reset_framework_llm_active,
)
from openlit.semcov import SemanticConvention
from openlit.instrumentation.strands.utils import (
    emit_strands_inference_event,
    extract_content_from_events,
    infer_provider_name,
    infer_server_address,
    record_strands_metrics,
    truncate_content,
    truncate_message_content,
)

logger = logging.getLogger(__name__)

# The Strands SDK tracer uses ``__name__`` which resolves to this module path.
_STRANDS_TRACER_SCOPE = "strands.telemetry.tracer"


class StrandsSpanProcessor(SpanProcessor):
    """Enriches Strands-generated spans with OpenLIT telemetry."""

    def __init__(
        self,
        version,
        environment,
        application_name,
        capture_message_content,
        metrics,
        disable_metrics,
        event_provider=None,
        pricing_info=None,
    ):
        self._version = version
        self._environment = environment
        self._application_name = application_name
        self._capture_message_content = capture_message_content
        self._metrics = metrics
        self._disable_metrics = disable_metrics
        self._event_provider = event_provider
        self._pricing_info = pricing_info
        self._fw_tokens_lock = threading.Lock()
        self._fw_tokens = {}

    # -----------------------------------------------------------------
    # Span detection
    # -----------------------------------------------------------------

    @staticmethod
    def _is_strands_span(span):
        """Return ``True`` if *span* was created by the Strands SDK tracer."""
        scope = getattr(span, "instrumentation_scope", None)
        if scope and getattr(scope, "name", None) == _STRANDS_TRACER_SCOPE:
            return True
        attrs = getattr(span, "attributes", None) or {}
        return (
            attrs.get("gen_ai.system") == "strands-agents"
            or attrs.get("gen_ai.provider.name") == "strands-agents"
        )

    # -----------------------------------------------------------------
    # Private helpers
    # -----------------------------------------------------------------

    @staticmethod
    def _set_attr(span, key, value):
        """Safely set an attribute on a ``ReadableSpan`` via ``_attributes``.

        After ``on_end`` the span is read-only; the only way to enrich it
        is to mutate the private ``_attributes`` mapping (a
        ``MappingProxyType``).  This is the same pattern used by
        OpenInference and is wrapped in a try/except for safety.
        """
        try:
            raw = getattr(span, "_attributes", None)
            if raw is not None:
                new_attrs = dict(raw)
                new_attrs[key] = value
                span._attributes = types.MappingProxyType(new_attrs)
        except Exception:
            pass

    @staticmethod
    def _set_attrs(span, mapping):
        """Batch version of ``_set_attr``."""
        try:
            raw = getattr(span, "_attributes", None)
            if raw is not None:
                new_attrs = dict(raw)
                new_attrs.update(mapping)
                span._attributes = types.MappingProxyType(new_attrs)
        except Exception:
            pass

    # -----------------------------------------------------------------
    # SpanProcessor API
    # -----------------------------------------------------------------

    def on_start(self, span, parent_context=None):
        """Add static OpenLIT attributes while the span is still writable.

        For ``chat`` spans, sets ``_framework_llm_span_active`` so that
        provider-level instrumentors (OpenAI, Anthropic, ...) skip creating
        their own duplicate chat span.
        """
        if not self._is_strands_span(span):
            return

        try:
            span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, self._version)
            span.set_attribute(DEPLOYMENT_ENVIRONMENT, self._environment)
            span.set_attribute(SERVICE_NAME, self._application_name)
        except Exception:
            pass

        if getattr(span, "name", "") == "chat":
            try:
                token = set_framework_llm_active()
                span_id = span.get_span_context().span_id
                with self._fw_tokens_lock:
                    self._fw_tokens[span_id] = token
            except Exception:
                pass

    def on_end(self, span):
        """Enrich the finished span with derived attributes and record metrics."""
        if not self._is_strands_span(span):
            return

        span_id = getattr(getattr(span, "context", None), "span_id", None)
        if span_id is not None:
            with self._fw_tokens_lock:
                fw_token = self._fw_tokens.pop(span_id, None)
            if fw_token is not None:
                try:
                    reset_framework_llm_active(fw_token)
                except Exception:
                    pass

        try:
            self._process_span(span)
        except Exception:
            logger.debug("Error processing Strands span", exc_info=True)

    def shutdown(self):
        """No-op; nothing to clean up."""

    def force_flush(self, timeout_millis=None):
        """No-op."""

    # -----------------------------------------------------------------
    # Core processing
    # -----------------------------------------------------------------

    def _process_span(self, span):
        attrs = span.attributes or {}
        operation = attrs.get("gen_ai.operation.name", "")

        # Normalize gen_ai.system → gen_ai.provider.name
        gen_ai_system = attrs.get("gen_ai.system", "")
        if gen_ai_system and not attrs.get(SemanticConvention.GEN_AI_PROVIDER_NAME):
            self._set_attr(span, SemanticConvention.GEN_AI_PROVIDER_NAME, gen_ai_system)

        # Remap Strands-native system_prompt → gen_ai.system_instructions
        if operation == "invoke_agent":
            system_prompt = attrs.get("system_prompt")
            if system_prompt and not attrs.get(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS):
                self._set_attr(
                    span, SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, system_prompt
                )

        # Duration (nanoseconds → seconds)
        duration = 0.0
        if span.end_time and span.start_time:
            duration = (span.end_time - span.start_time) / 1e9
        self._set_attr(
            span, SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
        )

        # Server address / port (inferred from model name)
        model_name = attrs.get("gen_ai.request.model", "")
        server_address = attrs.get(SemanticConvention.SERVER_ADDRESS, "")
        server_port = attrs.get(SemanticConvention.SERVER_PORT, 0)
        if not server_address and model_name:
            server_address, server_port = infer_server_address(model_name)
            if server_address:
                self._set_attrs(span, {
                    SemanticConvention.SERVER_ADDRESS: server_address,
                    SemanticConvention.SERVER_PORT: server_port,
                })

        # Normalize multi-agent operation names to invoke_workflow
        if operation in ("invoke_swarm", "invoke_graph"):
            workflow_name = attrs.get("gen_ai.agent.name", "")
            self._set_attrs(span, {
                SemanticConvention.GEN_AI_OPERATION: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                SemanticConvention.GEN_AI_WORKFLOW_NAME: workflow_name,
            })
            operation = "invoke_workflow"

        # Output type for agent / workflow spans
        if operation in ("invoke_agent", "invoke_workflow"):
            self._set_attr(
                span,
                SemanticConvention.GEN_AI_OUTPUT_TYPE,
                SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
            )

        # Tool type
        if operation == "execute_tool":
            self._set_attr(span, SemanticConvention.GEN_AI_TOOL_TYPE, "function")

        # Chat span enrichment: match provider span attributes
        if operation == "chat":
            self._enrich_chat_span(span, attrs, model_name)

        # Content capture: extract from events → span attributes
        if self._capture_message_content:
            self._extract_and_set_content(span, operation)

        # Emit inference log event for chat spans (provider span is
        # suppressed, so this processor is the single source of truth)
        if operation == "chat" and self._event_provider:
            self._emit_chat_inference_event(span, attrs, server_address, server_port)

        # Record OpenLIT metrics (skip spans without a recognized operation)
        if not self._disable_metrics and self._metrics and operation:
            record_strands_metrics(
                self._metrics,
                operation,
                duration,
                self._environment,
                self._application_name,
                model_name,
                server_address,
                server_port,
            )

    # -----------------------------------------------------------------
    # Chat span enrichment (parity with provider spans)
    # -----------------------------------------------------------------

    def _enrich_chat_span(self, span, attrs, model_name):
        """Add attributes to chat spans that match provider-level chat spans."""
        enrichments = {}

        # Span name: "chat" → "chat {model}" (matching OpenAI pattern)
        if model_name:
            try:
                span._name = f"chat {model_name}"
            except Exception:
                pass

        # Override gen_ai.provider.name with actual provider for chat spans
        provider = infer_provider_name(model_name) if model_name else ""
        if provider:
            enrichments[SemanticConvention.GEN_AI_PROVIDER_NAME] = provider

        # Finish reasons from output events
        _, output_msgs, _ = extract_content_from_events(span, "chat")
        if output_msgs:
            finish_reasons = [
                m.get("finish_reason")
                for m in output_msgs
                if isinstance(m, dict) and m.get("finish_reason")
            ]
            if finish_reasons:
                enrichments[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = finish_reasons

        enrichments[SemanticConvention.GEN_AI_OUTPUT_TYPE] = (
            SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
        )
        enrichments[SemanticConvention.GEN_AI_REQUEST_IS_STREAM] = True

        # Token totals and cost
        input_tokens = attrs.get("gen_ai.usage.input_tokens", 0)
        output_tokens = attrs.get("gen_ai.usage.output_tokens", 0)
        if input_tokens or output_tokens:
            enrichments[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] = (
                int(input_tokens) + int(output_tokens)
            )
        if self._pricing_info and model_name:
            cost = get_chat_model_cost(
                model_name, self._pricing_info, input_tokens, output_tokens
            )
            enrichments[SemanticConvention.GEN_AI_USAGE_COST] = cost

        if enrichments:
            self._set_attrs(span, enrichments)

    # -----------------------------------------------------------------
    # Content extraction → span attributes
    # -----------------------------------------------------------------

    def _extract_and_set_content(self, span, operation):
        """Extract messages from span events and set as span attributes."""
        try:
            input_msgs, output_msgs, system_instr = extract_content_from_events(
                span, operation
            )

            additions = {}

            if operation == "execute_tool":
                # For tool spans: map to tool-specific attributes
                if input_msgs:
                    first = input_msgs[0] if isinstance(input_msgs, list) else input_msgs
                    parts = first.get("parts", []) if isinstance(first, dict) else []
                    if parts:
                        arguments = parts[0].get("arguments", parts[0].get("response", ""))
                        additions[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS] = (
                            truncate_content(
                                json.dumps(arguments) if not isinstance(arguments, str) else arguments
                            )
                        )
                if output_msgs:
                    additions[SemanticConvention.GEN_AI_TOOL_CALL_RESULT] = (
                        truncate_content(json.dumps(output_msgs))
                    )
            else:
                if input_msgs:
                    truncate_message_content(input_msgs)
                    additions[SemanticConvention.GEN_AI_INPUT_MESSAGES] = json.dumps(
                        input_msgs
                    )
                if output_msgs:
                    truncate_message_content(output_msgs)
                    additions[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = json.dumps(
                        output_msgs
                    )
                if system_instr:
                    additions[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = (
                        truncate_content(str(system_instr))
                    )

            if additions:
                self._set_attrs(span, additions)
        except Exception:
            logger.debug("Error extracting Strands content", exc_info=True)

    # -----------------------------------------------------------------
    # Chat inference log event
    # -----------------------------------------------------------------

    def _emit_chat_inference_event(self, span, attrs, server_address, server_port):
        """Emit ``gen_ai.client.inference.operation.details`` for chat spans."""
        try:
            input_msgs, output_msgs, system_instr = extract_content_from_events(
                span, "chat"
            )

            extra = {}

            input_tokens = attrs.get("gen_ai.usage.input_tokens")
            output_tokens = attrs.get("gen_ai.usage.output_tokens")
            if input_tokens is not None:
                extra["input_tokens"] = input_tokens
            if output_tokens is not None:
                extra["output_tokens"] = output_tokens

            cache_read = attrs.get("gen_ai.usage.cache_read_input_tokens")
            cache_write = attrs.get("gen_ai.usage.cache_write_input_tokens")
            if cache_read is not None:
                extra["cache_read_input_tokens"] = cache_read
            if cache_write is not None:
                extra["cache_creation_input_tokens"] = cache_write

            if system_instr:
                extra["system_instructions"] = system_instr

            # Finish reason from output messages
            if output_msgs:
                finish_reasons = [
                    m.get("finish_reason")
                    for m in output_msgs
                    if isinstance(m, dict) and m.get("finish_reason")
                ]
                if finish_reasons:
                    extra["finish_reasons"] = finish_reasons

            emit_strands_inference_event(
                event_provider=self._event_provider,
                operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                request_model=attrs.get("gen_ai.request.model"),
                input_messages=input_msgs if self._capture_message_content else None,
                output_messages=output_msgs if self._capture_message_content else None,
                server_address=server_address,
                server_port=server_port,
                **extra,
            )
        except Exception:
            logger.debug("Error emitting Strands inference event", exc_info=True)
