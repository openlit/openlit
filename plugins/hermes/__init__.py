"""OpenLIT observer plugin for Hermes Agent.

Each user turn becomes an ``invoke_agent`` span, parent of its LLM and tool spans.
``gen_ai.conversation.id`` groups turns into a session: a session can outlive a process,
so a session-wide span might never be exported.

Hermes runs most hooks on helper threads, so nothing here relies on the ambient OTel context:
parents are passed explicitly, and shared state lives in dicts touched only by atomic
get/set/pop calls. LLM and tool spans are created when the call ends, from the timings in the
payload, which is why the plugin never registers ``pre_tool_call``: a slow or failing callback
there blocks the tool.

Hermes skips ``on_session_end`` when a turn stops early, for example on an API error it won't
retry, and a gateway may fire no other hook for that session. Such a turn is closed when the
next turn in its session starts, when the session is finalized, when the process exits, or
``ABANDON_AFTER_S`` after a non-retryable API error with nothing since (a fallback model call
in that window keeps the turn open). It is marked failed if its last model call failed.
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import wraps
from typing import Any
from urllib.parse import urlparse

from openlit.__helpers import (
    fetch_pricing_info,
    format_input_message,
    format_output_message,
    get_chat_model_cost,
    truncate_content,
)
from openlit.otel.tracing import setup_tracing
from openlit.semcov import SemanticConvention as SC
from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.trace import Span, SpanKind, Status, StatusCode

logger = logging.getLogger(__name__)

AGENT_NAME = "hermes"
DEFAULT_SERVICE_NAME = "hermes-agent"
FLUSH_TIMEOUT_MS = 5000
ABANDON_AFTER_S = 60.0


def fail_open(callback: Callable[..., None]) -> Callable[..., None]:
    """Keep telemetry from reaching Hermes: never raise, and never return a value, since some
    hook return values change the agent's behaviour."""

    @wraps(callback)
    def wrapper(**kwargs: Any) -> None:
        try:
            callback(**kwargs)
        except Exception:  # pylint: disable=broad-exception-caught
            logger.warning("OpenLIT hook %s failed", callback.__name__, exc_info=True)

    return wrapper


def _attrs(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value not in (None, "")}


def _to_ns(seconds: float | None) -> int:
    return int((seconds or time.time()) * 1e9)


def _to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _set_error(span: Span, error_type: str | None) -> None:
    span.set_status(Status(StatusCode.ERROR, error_type))
    if error_type:
        span.set_attribute(SC.ERROR_TYPE, error_type)


def _tool_call_parts(tool_calls: Any) -> list[dict[str, Any]]:
    """OTel GenAI ``tool_call`` parts from OpenAI-style tool calls."""
    parts = []
    for call in tool_calls if isinstance(tool_calls, list) else []:
        if not isinstance(call, dict):
            continue
        function = call.get("function") if isinstance(call.get("function"), dict) else {}
        arguments = function.get("arguments", call.get("arguments"))
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except ValueError:
                arguments = {"raw": truncate_content(arguments)}
        parts.append({
            "type": "tool_call",
            "id": call.get("id") or "",
            "name": function.get("name") or call.get("name") or "",
            "arguments": arguments or {},
        })
    return parts


def _message(role: str, content: Any, tool_calls: Any = None) -> dict[str, Any]:
    """One OTel GenAI message: its text, then any tool calls it requests."""
    if role == "tool":
        return {"role": role, "parts": [{
            "type": "tool_call_response",
            "id": "",
            "response": truncate_content(str(content or "")),
        }]}
    tool_parts = _tool_call_parts(tool_calls)
    if not tool_parts:
        return format_input_message(role, content or "")
    text = [{"type": "text", "content": truncate_content(str(content))}] if content else []
    return {"role": role, "parts": text + tool_parts}


def _input_messages(request: Any) -> list[dict[str, Any]]:
    """OTel GenAI messages from Hermes's sanitized provider request."""
    body = (request or {}).get("body") or {}
    messages = body.get("messages") or body.get("input") or []
    formatted = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        item = _message(
            message.get("role") or "user", message.get("content"), message.get("tool_calls")
        )
        if item["role"] == "tool":
            item["parts"][0]["id"] = message.get("tool_call_id") or ""
        formatted.append(item)
    return formatted


@dataclass
class Turn:
    """An open turn, and the context its LLM and tool spans parent to."""

    span: Span
    context: Context
    session_id: str = ""
    requests: dict[str, Any] = field(default_factory=dict)
    # When the turn last did something, and the error of its last model call, if that failed:
    # what a turn Hermes never ends is closed with.
    last_activity_ns: int = field(default_factory=time.time_ns)
    error_type: str | None = None


class Observer:
    """Turns Hermes hook payloads into spans."""

    def __init__(self, provider: Any, capture_content: bool = False) -> None:
        self.provider = provider
        self.tracer = provider.get_tracer(__name__)
        self.capture_content = capture_content
        self.pricing: dict[str, Any] = {}
        self.turns: dict[str, Turn] = {}
        self.subagent_parents: dict[str, Context] = {}
        self.abandon_after_s = ABANDON_AFTER_S

    def schedule(self, delay_s: float, callback: Callable[..., None], **kwargs: Any) -> None:
        timer = threading.Timer(delay_s, fail_open(callback), kwargs=kwargs)
        timer.name = "openlit-abandon"
        timer.daemon = True
        timer.start()

    def load_pricing(self) -> None:
        self.pricing = fetch_pricing_info(os.getenv("OPENLIT_PRICING_JSON"))

    def hooks(self) -> dict[str, Callable[..., None]]:
        hooks = {
            "pre_llm_call": self.turn_start,
            "on_session_end": self.turn_end,
            "on_session_finalize": self.session_finalize,
            "post_api_request": self.llm_call,
            "api_request_error": self.llm_call,
            "post_auxiliary_call": self.llm_call,
            "post_tool_call": self.tool_call,
            "subagent_start": self.subagent_start,
            "subagent_stop": self.subagent_stop,
        }
        # Only needed for content, and Hermes builds this payload only when a hook consumes it.
        if self.capture_content:
            hooks["pre_api_request"] = self.llm_request
            hooks["post_llm_call"] = self.turn_output
        return hooks

    def _parent(self, turn_id: str | None) -> Context:
        turn = self.turns.get(turn_id or "")
        return turn.context if turn else Context()

    def turn_start(self, **kwargs: Any) -> None:
        session_id = kwargs.get("session_id")
        # A session runs one turn at a time, so a turn still open here was abandoned.
        self._close_turns(lambda turn: turn.session_id == (session_id or ""))
        span = self.tracer.start_span(
            f"{SC.GEN_AI_OPERATION_TYPE_AGENT} {AGENT_NAME}",
            context=self.subagent_parents.get(session_id or "", Context()),
            kind=SpanKind.INTERNAL,
            attributes=_attrs(**{
                SC.GEN_AI_OPERATION: SC.GEN_AI_OPERATION_TYPE_AGENT,
                SC.GEN_AI_AGENT_NAME: AGENT_NAME,
                SC.GEN_AI_CONVERSATION_ID: session_id,
                SC.GEN_AI_REQUEST_MODEL: kwargs.get("model"),
                "hermes.platform": kwargs.get("platform"),
            }),
        )
        if self.capture_content:
            message = format_input_message("user", kwargs.get("user_message") or "")
            span.set_attribute(SC.GEN_AI_INPUT_MESSAGES, _to_json([message]))
        context = trace.set_span_in_context(span, Context())
        self.turns[kwargs.get("turn_id") or ""] = Turn(span, context, session_id or "")

    def turn_output(self, **kwargs: Any) -> None:
        turn = self.turns.get(kwargs.get("turn_id") or "")
        if turn:
            message = format_output_message(kwargs.get("assistant_response") or "")
            turn.span.set_attribute(SC.GEN_AI_OUTPUT_MESSAGES, _to_json([message]))

    def turn_end(self, **kwargs: Any) -> None:
        turn = self.turns.pop(kwargs.get("turn_id") or "", None)
        if not turn:
            return
        exit_reason = kwargs.get("turn_exit_reason")
        if exit_reason:
            turn.span.set_attribute("hermes.turn.exit_reason", exit_reason)
        turn.span.set_attribute("hermes.turn.interrupted", bool(kwargs.get("interrupted")))
        if kwargs.get("failed"):
            _set_error(turn.span, exit_reason)
        turn.span.end()
        self._flush_soon()

    def session_finalize(self, **kwargs: Any) -> None:
        """Session over (expired, reset, or the process shutting down): close its open turns."""
        session_id = kwargs.get("session_id") or ""
        self._close_turns(lambda turn: turn.session_id == session_id)

    def close_all(self) -> None:
        """At exit: close every open turn and ship it."""
        if self._close_turns(lambda turn: True, flush=False):
            self.flush()

    def _close_turns(self, matches: Callable[[Turn], bool], flush: bool = True) -> int:
        """End open turns Hermes never ended, at their last activity."""
        closed = 0
        for turn_id, turn in list(self.turns.items()):
            if not matches(turn) or self.turns.pop(turn_id, None) is None:
                continue
            turn.span.set_attribute("hermes.turn.exit_reason", "abandoned")
            if turn.error_type:
                _set_error(turn.span, turn.error_type)
            turn.span.end(end_time=turn.last_activity_ns)
            closed += 1
        if closed and flush:
            self._flush_soon()
        return closed

    def _flush_soon(self) -> None:
        # A gateway stopped inside the batch delay exits without flushing, so ship the turn now.
        threading.Thread(target=fail_open(self.flush), name="openlit-flush", daemon=True).start()

    def flush(self) -> None:
        self.provider.force_flush(FLUSH_TIMEOUT_MS)

    def llm_request(self, **kwargs: Any) -> None:
        turn = self.turns.get(kwargs.get("turn_id") or "")
        if turn:
            turn.requests[kwargs.get("api_request_id") or ""] = kwargs.get("request")

    def llm_call(self, **kwargs: Any) -> None:
        """One provider attempt: post_api_request, api_request_error or post_auxiliary_call."""
        model = kwargs.get("model") or ""
        response_model = kwargs.get("response_model")
        usage = kwargs.get("usage") or {}
        attributes = _attrs(**{
            SC.GEN_AI_OPERATION: SC.GEN_AI_OPERATION_TYPE_CHAT,
            SC.GEN_AI_PROVIDER_NAME: kwargs.get("provider"),
            SC.GEN_AI_REQUEST_MODEL: model,
            SC.GEN_AI_RESPONSE_MODEL: response_model,
            SC.GEN_AI_CONVERSATION_ID: kwargs.get("session_id"),
            SC.SERVER_ADDRESS: urlparse(kwargs.get("base_url") or "").hostname,
            "hermes.auxiliary_task": kwargs.get("aux_task"),
        })
        if kwargs.get("finish_reason"):
            attributes[SC.GEN_AI_RESPONSE_FINISH_REASON] = [kwargs["finish_reason"]]
        if usage:
            prompt_tokens = usage.get("prompt_tokens") or 0
            output_tokens = usage.get("output_tokens") or 0
            cache_read = usage.get("cache_read_tokens") or 0
            cache_write = usage.get("cache_write_tokens") or 0
            attributes |= {
                SC.GEN_AI_USAGE_INPUT_TOKENS: prompt_tokens,
                SC.GEN_AI_USAGE_OUTPUT_TOKENS: output_tokens,
                SC.GEN_AI_USAGE_TOTAL_TOKENS: prompt_tokens + output_tokens,
                SC.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS: cache_read,
                SC.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS: cache_write,
                SC.GEN_AI_USAGE_REASONING_TOKENS: usage.get("reasoning_tokens") or 0,
                SC.GEN_AI_USAGE_COST: get_chat_model_cost(
                    response_model or model, self.pricing, prompt_tokens, output_tokens,
                    cache_read, cache_write, prompt_tokens_include_cache=True,
                ),
            }

        turn_id = kwargs.get("turn_id")
        span = self.tracer.start_span(
            f"{SC.GEN_AI_OPERATION_TYPE_CHAT} {model}",
            context=self._parent(turn_id),
            kind=SpanKind.CLIENT,
            start_time=_to_ns(kwargs.get("started_at")),
            attributes=attributes,
        )
        if self.capture_content:
            self._set_llm_content(span, turn_id, kwargs)
        error = kwargs.get("error")
        error_type = None
        if error:
            # A post_auxiliary_call error is a string beside error_type; api_request_error's is a dict.
            nested_type = error.get("type") if isinstance(error, dict) else None
            error_type = kwargs.get("error_type") or nested_type or kwargs.get("reason")
            _set_error(span, error_type)
        end_ns = _to_ns(kwargs.get("ended_at"))
        span.end(end_time=end_ns)
        turn = self.turns.get(turn_id or "")
        if turn and not kwargs.get("aux_task"):
            turn.last_activity_ns = end_ns
            turn.error_type = (error_type or "error") if error else None
            if error and kwargs.get("retryable") is False:
                self.schedule(
                    self.abandon_after_s, self.close_if_idle, turn_id=turn_id, since_ns=end_ns
                )

    def close_if_idle(self, **kwargs: Any) -> None:
        """Close a turn that has done nothing since its non-retryable API error."""
        turn = self.turns.get(kwargs.get("turn_id") or "")
        if turn and turn.error_type and turn.last_activity_ns == kwargs.get("since_ns"):
            self._close_turns(lambda candidate: candidate is turn)

    def _set_llm_content(self, span: Span, turn_id: str | None, kwargs: dict[str, Any]) -> None:
        turn = self.turns.get(turn_id or "")
        pending = turn.requests.pop(kwargs.get("api_request_id") or "", None) if turn else None
        messages = _input_messages(pending or kwargs.get("request"))
        if messages:
            span.set_attribute(SC.GEN_AI_INPUT_MESSAGES, _to_json(messages))
        assistant = (kwargs.get("response") or {}).get("assistant_message") or {}
        content, tool_calls = assistant.get("content"), assistant.get("tool_calls")
        if content or tool_calls:
            message = _message("assistant", content, tool_calls)
            if kwargs.get("finish_reason"):
                message["finish_reason"] = kwargs["finish_reason"]
            span.set_attribute(SC.GEN_AI_OUTPUT_MESSAGES, _to_json([message]))

    def tool_call(self, **kwargs: Any) -> None:
        end_ns = time.time_ns()
        tool_name = kwargs.get("tool_name") or ""
        status = kwargs.get("status")
        span = self.tracer.start_span(
            f"{SC.GEN_AI_OPERATION_TYPE_TOOLS} {tool_name}",
            context=self._parent(kwargs.get("turn_id")),
            kind=SpanKind.INTERNAL,
            start_time=end_ns - int((kwargs.get("duration_ms") or 0) * 1e6),
            attributes=_attrs(**{
                SC.GEN_AI_OPERATION: SC.GEN_AI_OPERATION_TYPE_TOOLS,
                SC.GEN_AI_TOOL_NAME: tool_name,
                SC.GEN_AI_TOOL_CALL_ID: kwargs.get("tool_call_id"),
                SC.GEN_AI_CONVERSATION_ID: kwargs.get("session_id"),
                "hermes.tool.status": status,
            }),
        )
        if self.capture_content:
            span.set_attribute(SC.GEN_AI_TOOL_CALL_ARGUMENTS, _to_json(kwargs.get("args")))
            span.set_attribute(SC.GEN_AI_TOOL_CALL_RESULT, str(kwargs.get("result")))
        if status == "error":
            _set_error(span, kwargs.get("error_type"))
        span.end(end_time=end_ns)
        turn = self.turns.get(kwargs.get("turn_id") or "")
        if turn:
            turn.last_activity_ns = end_ns

    def subagent_start(self, **kwargs: Any) -> None:
        child_session_id = kwargs.get("child_session_id")
        if child_session_id:
            self.subagent_parents[child_session_id] = self._parent(kwargs.get("parent_turn_id"))

    def subagent_stop(self, **kwargs: Any) -> None:
        self.subagent_parents.pop(kwargs.get("child_session_id") or "", None)


def register(ctx: Any) -> None:
    """Hermes plugin entry point."""
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OPENLIT_URL")
    if not endpoint:
        # setup_tracing would otherwise print every span to the agent's terminal.
        logger.warning(
            "OpenLIT plugin disabled: set OTEL_EXPORTER_OTLP_ENDPOINT or OPENLIT_URL."
        )
        return

    api_key = os.getenv("OPENLIT_API_KEY")
    use_api_key = api_key and not os.getenv("OTEL_EXPORTER_OTLP_HEADERS")
    configured = setup_tracing(
        application_name=os.getenv("OTEL_SERVICE_NAME") or DEFAULT_SERVICE_NAME,
        environment=os.getenv("OPENLIT_ENVIRONMENT")
        or os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT")
        or "default",
        tracer=None,
        otlp_endpoint=endpoint,
        otlp_headers=f"Authorization=Bearer {api_key}" if use_api_key else None,
        disable_batch=False,
    )
    if configured is None:
        logger.warning("OpenLIT plugin disabled: tracing setup failed.")
        return

    capture = os.getenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "").lower() == "true"
    observer = Observer(trace.get_tracer_provider(), capture_content=capture)
    # Cost stays 0 until pricing arrives; fetching it inline would stall Hermes startup.
    threading.Thread(target=observer.load_pricing, name="openlit-pricing", daemon=True).start()
    for name, callback in observer.hooks().items():
        ctx.register_hook(name, fail_open(callback))
    # Registered after the tracer provider's own exit handler, so it runs first.
    atexit.register(fail_open(observer.close_all))
