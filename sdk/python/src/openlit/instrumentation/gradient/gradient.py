"""
Synchronous wrappers for DigitalOcean Gradient SDK resources.
"""

import time

from opentelemetry import context as context_api, trace as trace_api
from opentelemetry.trace import SpanKind

from openlit.__helpers import (
    handle_exception,
    is_framework_llm_active,
    record_completion_metrics,
    response_as_dict,
)
from openlit.instrumentation.gradient.utils import (
    _new_scope,
    common_chat_logic,
    process_chat_response,
    process_chunk,
    process_image_response,
    process_response_chunk,
    process_responses_response,
    process_retrieve_response,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


_DEFAULT_INFERENCE_HOST = "inference.do-ai.run"
_DEFAULT_AGENT_HOST = "agents.do-ai.run"
_DEFAULT_KB_HOST = "kbaas.do-ai.run"


def _agent_id_from_host(host):
    if not host or "agents.do-ai.run" not in host:
        return None
    head = host.split(".agents.do-ai.run", 1)[0]
    return head or None


def _resolve_endpoint(instance, kind, default_host):
    """Walk up to the Gradient client and read the per-resource endpoint.

    The shared Azure-style `_client.base_url` points to the control plane
    (api.digitalocean.com), not the actual inference / agent / KB host. The
    Gradient client stores the real per-route bases as `_inference_endpoint`,
    `_agent_endpoint`, and `_kbass_endpoint` (sic) — read those instead.
    `kind` is one of "inference", "agent", or "kb".
    """
    from urllib.parse import urlparse

    attr = {
        "inference": "_inference_endpoint",
        "agent": "_agent_endpoint",
        "kb": "_kbass_endpoint",
    }.get(kind)

    # Walk: resource → parent (.._client → top-level Gradient client)
    candidates = [instance]
    parent = getattr(instance, "_client", None)
    while parent is not None and parent not in candidates:
        candidates.append(parent)
        parent = getattr(parent, "_client", None)

    url = None
    for cand in candidates:
        if attr:
            url = getattr(cand, attr, None) or url
        if url:
            break

    if not url:
        return default_host, 443
    parsed = urlparse(str(url))
    host = parsed.hostname or default_host
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return host, port


def _make_traced_stream(chunk_processor, final_processor):
    class TracedSyncStream:
        """Wraps a Gradient sync Stream so chunks are observed and the span closes on completion."""

        def __init__(
            self, wrapped, span, body, server_address, server_port, finalize_kwargs
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._body = body
            self._server_address = server_address
            self._server_port = server_port
            self._finalize_kwargs = finalize_kwargs
            self._llmresponse = ""
            self._reasoning_text = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._tools = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._input_tokens = 0
            self._output_tokens = 0
            self._reasoning_tokens = 0
            self._start_time = time.time()
            self._end_time = None
            self._finalized = False
            self._iter = None

        def __enter__(self):
            if hasattr(self.__wrapped__, "__enter__"):
                self.__wrapped__.__enter__()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            if hasattr(self.__wrapped__, "__exit__"):
                self.__wrapped__.__exit__(exc_type, exc_value, traceback)
            self._finalize()

        def __iter__(self):
            return self

        def __getattr__(self, name):
            return getattr(self.__wrapped__, name)

        def _ensure_iter(self):
            if self._iter is None:
                if hasattr(self.__wrapped__, "__next__"):
                    self._iter = self.__wrapped__
                else:
                    self._iter = iter(self.__wrapped__)
            return self._iter

        def __next__(self):
            try:
                chunk = next(self._ensure_iter())
                chunk_processor(self, chunk)
                return chunk
            except StopIteration:
                self._finalize()
                raise

        def _finalize(self):
            if self._finalized:
                return
            self._finalized = True
            try:
                with trace_api.use_span(  # pylint: disable=not-context-manager
                    self._span, end_on_exit=True
                ):
                    final_processor(self, **self._finalize_kwargs)
            except Exception as exc:
                handle_exception(self._span, exc)

    return TracedSyncStream


def _build_wrapper(
    operation_name,
    api_type,
    process_response,
    chunk_processor,
    streaming_finalizer,
    default_host,
    span_name_prefix,
    is_agent=False,
    endpoint_kind="inference",
):
    def factory(
        version,
        environment,
        application_name,
        tracer,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
        event_provider=None,
    ):
        TracedSyncStream = _make_traced_stream(chunk_processor, streaming_finalizer)

        def wrapper(wrapped, instance, args, kwargs):
            if is_framework_llm_active():
                return wrapped(*args, **kwargs)

            body = dict(kwargs) if kwargs else {}
            streaming = bool(body.get("stream"))
            server_address, server_port = _resolve_endpoint(
                instance, endpoint_kind, default_host
            )
            request_model = body.get("model", "unknown")
            span_name = f"{span_name_prefix} {request_model}"
            start_time = time.time()
            agent_id = _agent_id_from_host(server_address) if is_agent else None

            if streaming:
                span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
                if agent_id:
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, agent_id)
                ctx = trace_api.set_span_in_context(span)
                token = context_api.attach(ctx)
                try:
                    result = wrapped(*args, **kwargs)
                except Exception as exc:
                    err_type = type(exc).__name__ or "_OTHER"
                    handle_exception(span, exc)
                    if not disable_metrics and metrics:
                        record_completion_metrics(
                            metrics,
                            operation_name,
                            SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
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
                            error_type=err_type,
                        )
                    context_api.detach(token)
                    span.end()
                    raise
                context_api.detach(token)

                if not hasattr(result, "__next__") and not hasattr(result, "__iter__"):
                    try:
                        with trace_api.use_span(  # pylint: disable=not-context-manager
                            span, end_on_exit=True
                        ):
                            return process_response(
                                response=result,
                                body=body,
                                pricing_info=pricing_info,
                                server_address=server_address,
                                server_port=server_port,
                                environment=environment,
                                application_name=application_name,
                                metrics=metrics,
                                start_time=start_time,
                                span=span,
                                capture_message_content=capture_message_content,
                                disable_metrics=disable_metrics,
                                version=version,
                                event_provider=event_provider,
                            )
                    except Exception as exc:
                        handle_exception(span, exc)
                        raise

                finalize_kwargs = {
                    "pricing_info": pricing_info,
                    "environment": environment,
                    "application_name": application_name,
                    "metrics": metrics,
                    "capture_message_content": capture_message_content,
                    "disable_metrics": disable_metrics,
                    "version": version,
                    "event_provider": event_provider,
                    "operation_name": operation_name,
                    "api_type": api_type,
                }
                return TracedSyncStream(
                    result, span, body, server_address, server_port, finalize_kwargs
                )

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                if agent_id:
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, agent_id)
                try:
                    response = wrapped(*args, **kwargs)
                except Exception as exc:
                    err_type = type(exc).__name__ or "_OTHER"
                    handle_exception(span, exc)
                    if not disable_metrics and metrics:
                        record_completion_metrics(
                            metrics,
                            operation_name,
                            SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
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
                            error_type=err_type,
                        )
                    raise
                try:
                    if is_agent:
                        # Reuse plain chat handling, but span operation is invoke_agent
                        response_dict = response_as_dict(response)
                        scope = _new_scope(
                            body,
                            span,
                            start_time,
                            server_address,
                            server_port,
                            response_dict,
                        )
                        choices = response_dict.get("choices") or []
                        if choices:
                            choice0 = choices[0]
                            message = choice0.get("message") or {}
                            scope._llmresponse = message.get("content") or ""
                            scope._finish_reason = choice0.get("finish_reason") or ""
                            if message.get("tool_calls"):
                                scope._tools = message["tool_calls"]
                        usage = response_dict.get("usage") or {}
                        scope._input_tokens = usage.get("prompt_tokens", 0) or 0
                        scope._output_tokens = usage.get("completion_tokens", 0) or 0
                        common_chat_logic(
                            scope,
                            pricing_info,
                            environment,
                            application_name,
                            metrics,
                            capture_message_content,
                            disable_metrics,
                            version,
                            is_stream=False,
                            operation_name=operation_name,
                            api_type=api_type,
                            event_provider=event_provider,
                        )
                        return response
                    return process_response(
                        response=response,
                        body=body,
                        pricing_info=pricing_info,
                        server_address=server_address,
                        server_port=server_port,
                        environment=environment,
                        application_name=application_name,
                        metrics=metrics,
                        start_time=start_time,
                        span=span,
                        capture_message_content=capture_message_content,
                        disable_metrics=disable_metrics,
                        version=version,
                        event_provider=event_provider,
                    )
                except Exception as exc:
                    handle_exception(span, exc)
                    return response

        return wrapper

    return factory


chat_completions = _build_wrapper(
    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    api_type="chat",
    process_response=process_chat_response,
    chunk_processor=process_chunk,
    streaming_finalizer=process_streaming_chat_response,
    default_host=_DEFAULT_INFERENCE_HOST,
    span_name_prefix=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
)

responses_create = _build_wrapper(
    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    api_type="responses",
    process_response=process_responses_response,
    chunk_processor=process_response_chunk,
    streaming_finalizer=process_streaming_chat_response,
    default_host=_DEFAULT_INFERENCE_HOST,
    span_name_prefix=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
)

agent_chat_completions = _build_wrapper(
    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    api_type="chat",
    process_response=process_chat_response,
    chunk_processor=process_chunk,
    streaming_finalizer=process_streaming_chat_response,
    default_host=_DEFAULT_AGENT_HOST,
    span_name_prefix=SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    is_agent=True,
    endpoint_kind="agent",
)


def image_generate(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """Sync wrapper for ImagesResource.generate."""

    def wrapper(wrapped, instance, args, kwargs):
        if is_framework_llm_active():
            return wrapped(*args, **kwargs)
        body = dict(kwargs) if kwargs else {}
        server_address, server_port = _resolve_endpoint(
            instance, "inference", _DEFAULT_INFERENCE_HOST
        )
        request_model = body.get("model", "unknown")
        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
        start_time = time.time()
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                response = wrapped(*args, **kwargs)
            except Exception as exc:
                handle_exception(span, exc)
                raise
            try:
                return process_image_response(
                    response=response,
                    body=body,
                    pricing_info=pricing_info,
                    server_address=server_address,
                    server_port=server_port,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                )
            except Exception as exc:
                handle_exception(span, exc)
                return response

    return wrapper


def retrieve_documents(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """Sync wrapper for RetrieveResource.documents."""

    def wrapper(wrapped, instance, args, kwargs):
        if is_framework_llm_active():
            return wrapped(*args, **kwargs)
        body = dict(kwargs) if kwargs else {}
        server_address, server_port = _resolve_endpoint(
            instance, "kb", _DEFAULT_KB_HOST
        )
        kb_id = body.get("knowledge_base_uuid") or body.get("knowledge_base_id") or ""
        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE} {kb_id or 'unknown'}"
        )
        start_time = time.time()
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                response = wrapped(*args, **kwargs)
            except Exception as exc:
                handle_exception(span, exc)
                raise
            try:
                return process_retrieve_response(
                    response=response,
                    body=body,
                    pricing_info=pricing_info,
                    server_address=server_address,
                    server_port=server_port,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                )
            except Exception as exc:
                handle_exception(span, exc)
                return response

    return wrapper
