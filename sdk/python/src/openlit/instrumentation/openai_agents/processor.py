"""
OpenLIT OpenAI Agents Instrumentation - Native TracingProcessor Implementation

Integrates with the OpenAI Agents SDK ``TracingProcessor`` interface.
All span data fields are read at ``on_span_end`` (when fully populated).
Compliant with OTel GenAI semantic conventions (gen-ai-spans.md,
gen-ai-agent-spans.md).
"""

import time
import threading
from collections import OrderedDict
from typing import Any, TYPE_CHECKING

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, Status, StatusCode, Link, set_span_in_context

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
)
from openlit.semcov import SemanticConvention
from openlit.instrumentation.openai_agents.utils import (
    get_operation_type,
    get_span_kind,
    generate_span_name,
    is_detailed_only,
    process_span_end,
)

try:
    from agents import TracingProcessor

    if TYPE_CHECKING:
        from agents import Trace, Span
    TRACING_AVAILABLE = True
except ImportError:

    class TracingProcessor:
        """Dummy TracingProcessor for when agents is not available."""

        def force_flush(self):
            return None

        def shutdown(self):
            return None

    if TYPE_CHECKING:
        Trace = Any
        Span = Any

    TRACING_AVAILABLE = False

_MAX_HANDOFFS = 1000


class OpenLITTracingProcessor(TracingProcessor):
    """
    OpenAI Agents tracing processor that emits OTel GenAI-compliant spans.

    Thread-safety: internal dicts are protected by a lock; no shared list
    (``span_stack``) is used.
    """

    def __init__(
        self,
        tracer,
        version,
        environment,
        application_name,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
        detailed_tracing,
        agent_creation_registry=None,
        **kwargs,
    ):
        super().__init__()

        self.tracer = tracer
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self.pricing_info = pricing_info
        self.capture_message_content = capture_message_content
        self.metrics = metrics
        self.disable_metrics = disable_metrics
        self.detailed_tracing = detailed_tracing
        self._agent_creation_registry = agent_creation_registry

        self._lock = threading.Lock()
        # SDK span_id -> (otel_span, start_time, ctx, context_token)
        self._otel_spans: dict = {}
        # SDK trace_id -> (otel_span, start_time, ctx, context_token)
        self._root_spans: dict = {}
        # trace_id -> group_id (conversation id)
        self._trace_group_ids: dict = {}
        # Agent handoff tracker (bounded OrderedDict)
        self._handoff_tracker: OrderedDict = OrderedDict()

    # ------------------------------------------------------------------
    # Trace lifecycle
    # ------------------------------------------------------------------
    def on_trace_start(self, trace):
        try:
            trace_id = getattr(trace, "trace_id", "unknown")
            trace_name = getattr(trace, "name", "workflow")
            group_id = getattr(trace, "group_id", None)

            operation = SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
            span_name = f"{operation} {trace_name}"

            span = self.tracer.start_span(
                span_name,
                kind=SpanKind.INTERNAL,
                attributes={
                    SemanticConvention.GEN_AI_OPERATION: operation,
                    SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                },
            )

            start_time = time.time()
            ctx = set_span_in_context(span)
            token = context_api.attach(ctx)

            with self._lock:
                self._root_spans[trace_id] = (span, start_time, ctx, token)
                if group_id:
                    self._trace_group_ids[trace_id] = str(group_id)

        except Exception as e:
            handle_exception(None, e)

    def on_trace_end(self, trace):
        try:
            trace_id = getattr(trace, "trace_id", "unknown")
            trace_name = getattr(trace, "name", "workflow")
            group_id = None

            with self._lock:
                entry = self._root_spans.pop(trace_id, None)
                group_id = self._trace_group_ids.pop(trace_id, None)

            if entry is None:
                return

            span, start_time, _ctx, token = entry
            end_time = time.time()

            scope = type("Scope", (), {})()
            scope._span = span
            scope._start_time = start_time
            scope._end_time = end_time

            common_framework_span_attributes(
                scope,
                SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                "api.openai.com",
                443,
                self.environment,
                self.application_name,
                self.version,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            )

            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            )
            span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, trace_name)

            if group_id:
                span.set_attribute(SemanticConvention.GEN_AI_CONVERSATION_ID, group_id)

            error = getattr(trace, "error", None)
            if error:
                error_msg = (
                    error.get("message", "unknown")
                    if isinstance(error, dict)
                    else str(error)
                )
                span.set_attribute(SemanticConvention.ERROR_TYPE, error_msg)
                span.set_status(Status(StatusCode.ERROR, error_msg))
            else:
                span.set_status(Status(StatusCode.OK))

            if not self.disable_metrics and self.metrics:
                from openlit.instrumentation.openai_agents.utils import _record_metrics

                _record_metrics(
                    self.metrics,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                    end_time - start_time,
                    self.environment,
                    self.application_name,
                    None,
                    "api.openai.com",
                    443,
                )

            if token is not None:
                context_api.detach(token)

            span.end()

        except Exception as e:
            handle_exception(None, e)

    # ------------------------------------------------------------------
    # Span lifecycle
    # ------------------------------------------------------------------
    # LLM span types handled by the OpenAI SDK instrumentation, which
    # produces richer telemetry (events, cost, TTFT, streaming flags, etc.).
    _LLM_SPAN_TYPES = frozenset(("response", "generation"))

    def on_span_start(self, span):
        try:
            sdk_span = span
            span_data = sdk_span.span_data
            span_type = getattr(span_data, "type", "unknown")

            if span_type in self._LLM_SPAN_TYPES:
                return

            if is_detailed_only(span_type) and not self.detailed_tracing:
                return

            trace_id = getattr(sdk_span, "trace_id", "unknown")
            sdk_span_id = getattr(sdk_span, "span_id", None)
            parent_sdk_id = getattr(sdk_span, "parent_id", None)

            operation = get_operation_type(span_type)
            kind = get_span_kind(operation)
            span_name = generate_span_name(span_data)

            # Find parent OTel span context
            parent_ctx = None
            with self._lock:
                if parent_sdk_id and parent_sdk_id in self._otel_spans:
                    parent_otel, _, _, _ = self._otel_spans[parent_sdk_id]
                    parent_ctx = set_span_in_context(parent_otel)
                elif trace_id in self._root_spans:
                    _, _, parent_ctx, _ = self._root_spans[trace_id]

            # Span links: connect invoke_agent back to create_agent
            links = []
            if span_type == "agent" and self._agent_creation_registry:
                agent_name = getattr(span_data, "name", None)
                if agent_name:
                    creation_ctx = self._agent_creation_registry.get(str(agent_name))
                    if creation_ctx:
                        links.append(Link(creation_ctx))

            otel_span = self.tracer.start_span(
                span_name,
                kind=kind,
                context=parent_ctx,
                links=links,
                attributes={
                    SemanticConvention.GEN_AI_OPERATION: operation,
                    SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                },
            )

            start_time = time.time()
            ctx = set_span_in_context(otel_span)
            token = context_api.attach(ctx)

            if sdk_span_id:
                with self._lock:
                    self._otel_spans[sdk_span_id] = (otel_span, start_time, ctx, token)

        except Exception as e:
            handle_exception(None, e)

    def on_span_end(self, span):
        try:
            sdk_span = span
            span_data = sdk_span.span_data
            span_type = getattr(span_data, "type", "unknown")

            if span_type in self._LLM_SPAN_TYPES:
                return

            if is_detailed_only(span_type) and not self.detailed_tracing:
                return

            sdk_span_id = getattr(sdk_span, "span_id", None)
            trace_id = getattr(sdk_span, "trace_id", "unknown")

            entry = None
            with self._lock:
                entry = self._otel_spans.pop(sdk_span_id, None) if sdk_span_id else None
                conversation_id = self._trace_group_ids.get(trace_id)

            if entry is None:
                return

            otel_span, start_time, _ctx, token = entry

            process_span_end(
                otel_span=otel_span,
                sdk_span=sdk_span,
                start_time=start_time,
                version=self.version,
                environment=self.environment,
                application_name=self.application_name,
                capture_message_content=self.capture_message_content,
                metrics=self.metrics,
                disable_metrics=self.disable_metrics,
                conversation_id=conversation_id,
                handoff_tracker=self._handoff_tracker,
            )

            if token is not None:
                context_api.detach(token)

            otel_span.end()

        except Exception as e:
            handle_exception(None, e)

    # ------------------------------------------------------------------
    # Lifecycle management
    # ------------------------------------------------------------------
    def force_flush(self):
        try:
            with self._lock:
                for otel_span, _, _, token in self._otel_spans.values():
                    try:
                        if token is not None:
                            context_api.detach(token)
                        otel_span.end()
                    except Exception:
                        pass
                self._otel_spans.clear()

                for otel_span, _, _, token in self._root_spans.values():
                    try:
                        if token is not None:
                            context_api.detach(token)
                        otel_span.end()
                    except Exception:
                        pass
                self._root_spans.clear()
                self._trace_group_ids.clear()
        except Exception as e:
            handle_exception(None, e)

    def shutdown(self):
        self.force_flush()
