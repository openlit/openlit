"""
Claude Agent SDK async wrappers — OTel GenAI semantic convention compliant.

Wraps ``query()`` and ``ClaudeSDKClient`` methods to produce ``invoke_agent``
and ``execute_tool`` spans using the same patterns as CrewAI / LangGraph.

Tool spans are created via the SDK's hook system (PreToolUse / PostToolUse /
PostToolUseFailure).  A message-based fallback handles cases where hooks
cannot be injected.
"""

import time

from opentelemetry import context as context_api
from opentelemetry import trace as trace_api
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention
from openlit.instrumentation.claude_agent_sdk.utils import (
    generate_span_name,
    set_initial_span_attributes,
    update_root_from_assistant,
    has_llm_call_data,
    build_input_from_tool_results,
    set_chat_span_attributes,
    set_create_agent_attributes,
    process_result_message,
    finalize_span,
    set_tool_span_attributes,
    finalize_tool_span,
    GEN_AI_SYSTEM_ATTR,
    GEN_AI_SYSTEM_VALUE,
)

# Attribute key stored on client instances to pass prompt between wrappers
_PROMPT_ATTR = "_openlit_last_prompt"
_HOOKS_INJECTED_ATTR = "_openlit_hooks_injected"


# ---------------------------------------------------------------------------
# Tool span tracker — shared between hooks and the message stream
# ---------------------------------------------------------------------------
class _ToolSpanTracker:
    """Manages in-flight tool spans created by SDK hooks."""

    def __init__(
        self,
        tracer,
        parent_span,
        version,
        environment,
        application_name,
        capture_message_content,
    ):
        self._tracer = tracer
        self._parent_span = parent_span
        self._version = version
        self._environment = environment
        self._application_name = application_name
        self._capture_message_content = capture_message_content
        self._in_flight: dict = {}
        self._completed: set = set()

    def start_tool(self, tool_name, tool_input, tool_use_id):
        """Create and track a new tool span."""
        span_name = generate_span_name("execute_tool", tool_name)
        parent_ctx = trace_api.set_span_in_context(self._parent_span)

        span = self._tracer.start_span(
            span_name, kind=SpanKind.INTERNAL, context=parent_ctx
        )
        set_tool_span_attributes(
            span,
            tool_name,
            tool_input,
            tool_use_id,
            self._capture_message_content,
            self._environment,
            self._application_name,
            self._version,
        )
        self._in_flight[tool_use_id] = span

    def end_tool(self, tool_use_id, tool_response=None):
        """End a tool span successfully."""
        span = self._in_flight.pop(tool_use_id, None)
        if span:
            finalize_tool_span(span, tool_response, self._capture_message_content)
            span.end()
            self._completed.add(tool_use_id)

    def end_tool_error(self, tool_use_id, error=None):
        """End a tool span with an error."""
        span = self._in_flight.pop(tool_use_id, None)
        if span:
            finalize_tool_span(
                span,
                None,
                self._capture_message_content,
                is_error=True,
                error_message=error,
            )
            span.end()
            self._completed.add(tool_use_id)

    def end_all(self):
        """End all in-flight tool spans (cleanup)."""
        for tool_use_id in list(self._in_flight.keys()):
            span = self._in_flight.pop(tool_use_id, None)
            if span:
                finalize_tool_span(
                    span,
                    None,
                    self._capture_message_content,
                    is_error=True,
                    error_message="abandoned",
                )
                span.end()


# ---------------------------------------------------------------------------
# Subagent span tracker — for Task tool (programmatic subagents)
# ---------------------------------------------------------------------------
class _SubagentSpanTracker:
    """Manages subagent spans triggered by TaskStarted / TaskNotification messages."""

    def __init__(self, tracer, tool_tracker, version, environment, application_name):
        self._tracer = tracer
        self._tool_tracker = tool_tracker
        self._version = version
        self._environment = environment
        self._application_name = application_name
        self._in_flight: dict = {}
        self._tool_use_to_task: dict = {}

    def start_subagent(self, task_id, description, tool_use_id=None):
        """Create a subagent span, parented under the corresponding tool span."""
        name = description or task_id or "subagent"
        span_name = generate_span_name("subagent", name)

        if tool_use_id:
            self._tool_use_to_task[tool_use_id] = task_id

        parent_span = None
        if tool_use_id and tool_use_id in self._tool_tracker._in_flight:
            parent_span = self._tool_tracker._in_flight[tool_use_id]

        ctx = trace_api.set_span_in_context(parent_span) if parent_span else None

        span = self._tracer.start_span(span_name, kind=SpanKind.INTERNAL, context=ctx)
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )
        span.set_attribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE)
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))
        span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, self._environment)
        span.set_attribute(
            SemanticConvention.GEN_AI_APPLICATION_NAME, self._application_name
        )
        span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, self._version)

        self._in_flight[task_id] = span

    def end_subagent(self, task_id, is_error=False, error_message=None, usage=None):
        """End a subagent span, optionally setting usage attributes."""
        span = self._in_flight.pop(task_id, None)
        if span:
            if usage:
                total_tokens = usage.get("total_tokens")
                if total_tokens is not None:
                    try:
                        span.set_attribute(
                            SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                            int(total_tokens),
                        )
                    except (TypeError, ValueError):
                        pass
                tool_uses = usage.get("tool_uses")
                if tool_uses is not None:
                    try:
                        span.set_attribute("gen_ai.agent.tool_uses", int(tool_uses))
                    except (TypeError, ValueError):
                        pass
                duration_ms = usage.get("duration_ms")
                if duration_ms is not None:
                    try:
                        span.set_attribute("gen_ai.agent.duration_ms", int(duration_ms))
                    except (TypeError, ValueError):
                        pass

            if is_error:
                err = str(error_message) if error_message else "task failed"
                span.set_attribute(SemanticConvention.ERROR_TYPE, err)
                span.set_status(Status(StatusCode.ERROR, err))
            else:
                span.set_status(Status(StatusCode.OK))
            span.end()

    def get_span_for_tool_use_id(self, tool_use_id):
        """Return the subagent span that owns this tool_use_id, or None."""
        task_id = self._tool_use_to_task.get(tool_use_id)
        if task_id:
            return self._in_flight.get(task_id)
        return None

    def end_all(self):
        """End all in-flight subagent spans (cleanup)."""
        for task_id in list(self._in_flight.keys()):
            self.end_subagent(task_id, is_error=True, error_message="abandoned")


# ---------------------------------------------------------------------------
# Hook factory — creates callbacks that drive the tool & subagent trackers
# ---------------------------------------------------------------------------
def _build_tool_hooks(tracker):
    """Return (pre, post, failure) async hook callbacks bound to *tracker*."""

    async def pre_tool_use(input_data, tool_use_id, context):
        try:
            tool_name = input_data.get("tool_name", "unknown")
            tool_input = input_data.get("tool_input")
            tracker.start_tool(tool_name, tool_input, tool_use_id)
        except Exception:
            pass
        return {}

    async def post_tool_use(input_data, tool_use_id, context):
        try:
            tool_response = input_data.get("tool_response")
            tracker.end_tool(tool_use_id, tool_response)
        except Exception:
            pass
        return {}

    async def post_tool_use_failure(input_data, tool_use_id, context):
        try:
            error = input_data.get("error", "unknown error")
            tracker.end_tool_error(tool_use_id, error)
        except Exception:
            pass
        return {}

    return pre_tool_use, post_tool_use, post_tool_use_failure


def _build_subagent_hooks(subagent_tracker):
    """Return (start, stop) async hook callbacks bound to *subagent_tracker*."""

    async def subagent_start(input_data, tool_use_id, context):
        try:
            agent_id = input_data.get("agent_id")
            description = input_data.get("description", agent_id or "subagent")
            if agent_id and subagent_tracker:
                subagent_tracker.start_subagent(agent_id, description, tool_use_id)
        except Exception:
            pass
        return {}

    async def subagent_stop(input_data, tool_use_id, context):
        try:
            agent_id = input_data.get("agent_id")
            if not agent_id or not subagent_tracker:
                return {}
            error = input_data.get("error")
            is_error = bool(error)
            subagent_tracker.end_subagent(
                agent_id, is_error=is_error, error_message=error
            )
        except Exception:
            pass
        return {}

    return subagent_start, subagent_stop


# ---------------------------------------------------------------------------
# Hook injection — merges OpenLIT hooks into user-provided options
# ---------------------------------------------------------------------------
def _inject_hooks(options, tracker, subagent_tracker=None):
    """Merge tracing hooks into *options*, preserving user-defined hooks.

    Modifies ``options.hooks`` in place and returns *options*.
    """
    try:
        from claude_agent_sdk.types import HookMatcher
    except ImportError:
        return options

    pre, post, failure = _build_tool_hooks(tracker)

    if options.hooks is None:
        options.hooks = {}

    hook_pairs = [
        ("PreToolUse", pre),
        ("PostToolUse", post),
        ("PostToolUseFailure", failure),
    ]

    if subagent_tracker:
        sa_start, sa_stop = _build_subagent_hooks(subagent_tracker)
        hook_pairs.extend(
            [
                ("SubagentStart", sa_start),
                ("SubagentStop", sa_stop),
            ]
        )

    for event, callback in hook_pairs:
        matcher = HookMatcher(matcher=None, hooks=[callback])
        if event in options.hooks:
            options.hooks[event].append(matcher)
        else:
            options.hooks[event] = [matcher]

    return options


def _get_or_create_options(kwargs):
    """Return the ClaudeAgentOptions from *kwargs*, creating one if absent."""
    try:
        from claude_agent_sdk.types import ClaudeAgentOptions
    except ImportError:
        return kwargs.get("options"), kwargs

    options = kwargs.get("options")
    if options is None:
        options = ClaudeAgentOptions()
        kwargs["options"] = options
    return options, kwargs


# ---------------------------------------------------------------------------
# Chat child span — deferred creation for correct content & ordering
# ---------------------------------------------------------------------------
def _buffer_chat_message(message, chat_state):
    """Buffer an AssistantMessage for deferred chat span creation.

    The Claude Agent SDK yields the same ``message_id`` in multiple chunks:
    first with text / thinking, then with tool_use blocks.  By buffering
    and replacing on the same ``message_id``, we capture the most complete
    content.  A different ``message_id`` means a new LLM turn — the caller
    must flush the previous buffer first via ``_flush_pending_chat``.
    """
    if not has_llm_call_data(message):
        return

    chat_state["pending_chat_msg"] = message
    chat_state["pending_chat_msg_id"] = getattr(message, "message_id", None)
    chat_state["pending_end_ns"] = time.time_ns()


def _flush_pending_chat(
    tracer,
    parent_span,
    chat_state,
    capture_message_content,
    version,
    environment,
    application_name,
    pricing_info=None,
    event_provider=None,
    subagent_tracker=None,
):
    """Create a ``chat {model}`` child span from the buffered AssistantMessage."""
    message = chat_state.pop("pending_chat_msg", None)
    if message is None:
        return

    chat_state.pop("pending_chat_msg_id", None)
    end_ns = chat_state.pop("pending_end_ns", time.time_ns())

    model = str(getattr(message, "model", "unknown"))
    span_name = generate_span_name("chat", model)

    effective_parent = parent_span
    parent_tool_use_id = getattr(message, "parent_tool_use_id", None)
    if parent_tool_use_id and subagent_tracker:
        subagent_span = subagent_tracker.get_span_for_tool_use_id(parent_tool_use_id)
        if subagent_span:
            effective_parent = subagent_span

    parent_ctx = trace_api.set_span_in_context(effective_parent)
    start_ns = chat_state.get("last_boundary_ns", end_ns)

    chat_span = tracer.start_span(
        span_name,
        kind=SpanKind.CLIENT,
        context=parent_ctx,
        start_time=start_ns,
    )

    input_messages = chat_state.pop("pending_input", None)

    set_chat_span_attributes(
        chat_span,
        message,
        capture_message_content,
        environment,
        application_name,
        version,
        pricing_info=pricing_info,
        event_provider=event_provider,
        input_messages=input_messages,
    )
    chat_span.end(end_time=end_ns)

    chat_state["last_boundary_ns"] = end_ns


# ---------------------------------------------------------------------------
# Message stream processor
# ---------------------------------------------------------------------------
def _process_message(
    message,
    span,
    tool_tracker,
    subagent_tracker,
    capture_message_content,
    tracer,
    chat_state,
    version,
    environment,
    application_name,
    pricing_info=None,
    event_provider=None,
):
    """Inspect a yielded message and update spans accordingly.

    Returns a usage dict ``{"input_tokens": int, "output_tokens": int}`` when
    the message is a ``ResultMessage``; ``None`` otherwise.
    """

    flush_kw = {
        "tracer": tracer,
        "parent_span": span,
        "chat_state": chat_state,
        "capture_message_content": capture_message_content,
        "version": version,
        "environment": environment,
        "application_name": application_name,
        "pricing_info": pricing_info,
        "event_provider": event_provider,
        "subagent_tracker": subagent_tracker,
    }

    msg_type = type(message).__name__
    result_usage = None

    if msg_type == "AssistantMessage":
        update_root_from_assistant(span, message)

        if has_llm_call_data(message):
            new_msg_id = getattr(message, "message_id", None)
            pending_msg_id = chat_state.get("pending_chat_msg_id")
            if pending_msg_id is not None and new_msg_id != pending_msg_id:
                _flush_pending_chat(**flush_kw)
            _buffer_chat_message(message, chat_state)

    elif msg_type == "UserMessage":
        _flush_pending_chat(**flush_kw)
        if capture_message_content:
            tool_input = build_input_from_tool_results(message)
            if tool_input:
                chat_state["pending_input"] = tool_input

    elif msg_type == "ResultMessage":
        _flush_pending_chat(**flush_kw)
        result_usage = process_result_message(span, message, capture_message_content)

    elif msg_type == "TaskStartedMessage":
        _flush_pending_chat(**flush_kw)
        try:
            task_id = getattr(message, "task_id", None)
            description = getattr(message, "description", None)
            tool_use_id = getattr(message, "tool_use_id", None)
            if task_id and subagent_tracker:
                subagent_tracker.start_subagent(task_id, description, tool_use_id)
        except Exception:
            pass

    elif msg_type == "TaskNotificationMessage":
        _flush_pending_chat(**flush_kw)
        try:
            task_id = getattr(message, "task_id", None)
            status = getattr(message, "status", None)
            is_error = status in ("failed", "error", "stopped")
            error_msg = getattr(message, "summary", None) if is_error else None
            task_usage = getattr(message, "usage", None)
            usage_dict = None
            if task_usage is not None:
                if isinstance(task_usage, dict):
                    usage_dict = task_usage
                else:
                    usage_dict = {
                        "total_tokens": getattr(task_usage, "total_tokens", None),
                        "tool_uses": getattr(task_usage, "tool_uses", None),
                        "duration_ms": getattr(task_usage, "duration_ms", None),
                    }
            if task_id and subagent_tracker:
                subagent_tracker.end_subagent(
                    task_id, is_error, error_msg, usage=usage_dict
                )
        except Exception:
            pass

    chat_state["last_boundary_ns"] = time.time_ns()
    return result_usage


# ---------------------------------------------------------------------------
# Message-based tool span fallback (when hooks cannot be injected)
# ---------------------------------------------------------------------------
def _process_tool_blocks_from_messages(message, tool_tracker, subagent_tracker=None):
    """Fallback: create/end tool spans by scanning content blocks.

    Skips tool_use_ids already handled by the hook system (tracked in
    ``tool_tracker._completed``) to avoid duplicate spans.

    When *subagent_tracker* is provided and the message has a
    ``parent_tool_use_id``, tool spans are parented under the subagent
    span instead of the root.
    """
    msg_type = type(message).__name__

    if msg_type == "AssistantMessage":
        content = getattr(message, "content", None)
        if not content:
            return

        parent_tool_use_id = getattr(message, "parent_tool_use_id", None)
        effective_parent = None
        if parent_tool_use_id and subagent_tracker:
            effective_parent = subagent_tracker.get_span_for_tool_use_id(
                parent_tool_use_id
            )

        for block in content:
            if type(block).__name__ == "ToolUseBlock":
                tool_name = getattr(block, "name", "unknown")
                tool_input = getattr(block, "input", None)
                tool_id = getattr(block, "id", None)
                if (
                    tool_id
                    and tool_id not in tool_tracker._in_flight
                    and tool_id not in tool_tracker._completed
                ):
                    if effective_parent:
                        span_name = generate_span_name("execute_tool", tool_name)
                        parent_ctx = trace_api.set_span_in_context(effective_parent)
                        span = tool_tracker._tracer.start_span(
                            span_name, kind=SpanKind.INTERNAL, context=parent_ctx
                        )
                        set_tool_span_attributes(
                            span,
                            tool_name,
                            tool_input,
                            tool_id,
                            tool_tracker._capture_message_content,
                            tool_tracker._environment,
                            tool_tracker._application_name,
                            tool_tracker._version,
                        )
                        tool_tracker._in_flight[tool_id] = span
                    else:
                        tool_tracker.start_tool(tool_name, tool_input, tool_id)

    elif msg_type == "UserMessage":
        content = getattr(message, "content", None)
        if not content or not isinstance(content, list):
            return
        for block in content:
            if type(block).__name__ == "ToolResultBlock":
                tool_use_id = getattr(block, "tool_use_id", None)
                is_error = getattr(block, "is_error", False)
                result_content = getattr(block, "content", None)
                if tool_use_id and tool_use_id in tool_tracker._in_flight:
                    if is_error:
                        tool_tracker.end_tool_error(tool_use_id, result_content)
                    else:
                        tool_tracker.end_tool(tool_use_id, result_content)


# ---------------------------------------------------------------------------
# wrap_query — wraps the stateless query() async generator
# ---------------------------------------------------------------------------
def wrap_query(
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
    """Return a wrapt-compatible wrapper for ``claude_agent_sdk.query.query``."""

    async def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            async for msg in wrapped(*args, **kwargs):
                yield msg
            return

        span_name = generate_span_name("query")
        span = tracer.start_span(span_name, kind=SpanKind.INTERNAL)
        ctx = trace_api.set_span_in_context(span)
        token = context_api.attach(ctx)
        start_time = time.time()
        chat_state = {"last_boundary_ns": time.time_ns()}

        tool_tracker = _ToolSpanTracker(
            tracer,
            span,
            version,
            environment,
            application_name,
            capture_message_content,
        )
        subagent_tracker = _SubagentSpanTracker(
            tracer,
            tool_tracker,
            version,
            environment,
            application_name,
        )
        aggregate_usage = {"input_tokens": 0, "output_tokens": 0}

        try:
            options, kwargs = _get_or_create_options(kwargs)
            prompt = kwargs.get("prompt")

            if prompt and capture_message_content:
                chat_state["pending_input"] = [
                    {
                        "role": "user",
                        "parts": [{"type": "text", "content": str(prompt)}],
                    }
                ]

            _inject_hooks(options, tool_tracker, subagent_tracker)

            set_initial_span_attributes(
                span,
                start_time,
                version,
                environment,
                application_name,
                options,
                prompt,
                capture_message_content,
            )

            has_result = False
            async for message in wrapped(*args, **kwargs):
                msg_usage = _process_message(
                    message,
                    span,
                    tool_tracker,
                    subagent_tracker,
                    capture_message_content,
                    tracer,
                    chat_state,
                    version,
                    environment,
                    application_name,
                    pricing_info=pricing_info,
                    event_provider=event_provider,
                )
                if msg_usage:
                    aggregate_usage["input_tokens"] = msg_usage.get("input_tokens", 0)
                    aggregate_usage["output_tokens"] = msg_usage.get("output_tokens", 0)
                _process_tool_blocks_from_messages(
                    message, tool_tracker, subagent_tracker
                )

                if type(message).__name__ == "ResultMessage":
                    has_result = True

                yield message

            _flush_pending_chat(
                tracer=tracer,
                parent_span=span,
                chat_state=chat_state,
                capture_message_content=capture_message_content,
                version=version,
                environment=environment,
                application_name=application_name,
                pricing_info=pricing_info,
                event_provider=event_provider,
                subagent_tracker=subagent_tracker,
            )

            if not has_result:
                span.set_status(Status(StatusCode.OK))

        except Exception as e:
            handle_exception(span, e)
            raise
        finally:
            subagent_tracker.end_all()
            tool_tracker.end_all()
            finalize_span(
                span,
                start_time,
                metrics,
                disable_metrics,
                environment,
                application_name,
                input_tokens=aggregate_usage["input_tokens"],
                output_tokens=aggregate_usage["output_tokens"],
            )
            span.end()
            context_api.detach(token)

    return wrapper


# ---------------------------------------------------------------------------
# wrap_connect — captures initial prompt, emits create_agent, injects hooks
# ---------------------------------------------------------------------------
def wrap_connect(
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
    """Return a wrapt-compatible wrapper for ``ClaudeSDKClient.connect``."""

    async def wrapper(wrapped, instance, args, kwargs):
        try:
            prompt = kwargs.get("prompt") or (args[0] if args else None)
            setattr(instance, _PROMPT_ATTR, prompt)
        except Exception:
            pass

        span_name = generate_span_name("create_agent", "claude_agent_sdk")
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            set_create_agent_attributes(
                span,
                version,
                environment,
                application_name,
            )
            try:
                result = await wrapped(*args, **kwargs)
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


# ---------------------------------------------------------------------------
# wrap_client_query — captures prompt for subsequent receive_response
# ---------------------------------------------------------------------------
def wrap_client_query(
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
    """Return a wrapt-compatible wrapper for ``ClaudeSDKClient.query``."""

    async def wrapper(wrapped, instance, args, kwargs):
        try:
            prompt = kwargs.get("prompt") or (args[0] if args else None)
            setattr(instance, _PROMPT_ATTR, prompt)
        except Exception:
            pass

        return await wrapped(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# wrap_receive_response — wraps the per-turn async generator
# ---------------------------------------------------------------------------
def wrap_receive_response(
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
    """Return a wrapt-compatible wrapper for ``ClaudeSDKClient.receive_response``."""

    async def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            async for msg in wrapped(*args, **kwargs):
                yield msg
            return

        span_name = generate_span_name("receive_response")
        span = tracer.start_span(span_name, kind=SpanKind.INTERNAL)
        ctx = trace_api.set_span_in_context(span)
        token = context_api.attach(ctx)
        start_time = time.time()
        chat_state = {"last_boundary_ns": time.time_ns()}

        tool_tracker = _ToolSpanTracker(
            tracer,
            span,
            version,
            environment,
            application_name,
            capture_message_content,
        )
        subagent_tracker = _SubagentSpanTracker(
            tracer,
            tool_tracker,
            version,
            environment,
            application_name,
        )
        aggregate_usage = {"input_tokens": 0, "output_tokens": 0}

        try:
            prompt = getattr(instance, _PROMPT_ATTR, None)
            options = getattr(instance, "_options", None)

            if prompt and capture_message_content:
                chat_state["pending_input"] = [
                    {
                        "role": "user",
                        "parts": [{"type": "text", "content": str(prompt)}],
                    }
                ]

            if not getattr(instance, _HOOKS_INJECTED_ATTR, False):
                if options is not None:
                    _inject_hooks(options, tool_tracker, subagent_tracker)
                    setattr(instance, _HOOKS_INJECTED_ATTR, True)

            set_initial_span_attributes(
                span,
                start_time,
                version,
                environment,
                application_name,
                options,
                prompt,
                capture_message_content,
            )

            has_result = False
            async for message in wrapped(*args, **kwargs):
                msg_usage = _process_message(
                    message,
                    span,
                    tool_tracker,
                    subagent_tracker,
                    capture_message_content,
                    tracer,
                    chat_state,
                    version,
                    environment,
                    application_name,
                    pricing_info=pricing_info,
                    event_provider=event_provider,
                )
                if msg_usage:
                    aggregate_usage["input_tokens"] = msg_usage.get("input_tokens", 0)
                    aggregate_usage["output_tokens"] = msg_usage.get("output_tokens", 0)
                _process_tool_blocks_from_messages(
                    message, tool_tracker, subagent_tracker
                )

                if type(message).__name__ == "ResultMessage":
                    has_result = True

                yield message

            _flush_pending_chat(
                tracer=tracer,
                parent_span=span,
                chat_state=chat_state,
                capture_message_content=capture_message_content,
                version=version,
                environment=environment,
                application_name=application_name,
                pricing_info=pricing_info,
                event_provider=event_provider,
                subagent_tracker=subagent_tracker,
            )

            if not has_result:
                span.set_status(Status(StatusCode.OK))

        except Exception as e:
            handle_exception(span, e)
            raise
        finally:
            subagent_tracker.end_all()
            tool_tracker.end_all()
            finalize_span(
                span,
                start_time,
                metrics,
                disable_metrics,
                environment,
                application_name,
                input_tokens=aggregate_usage["input_tokens"],
                output_tokens=aggregate_usage["output_tokens"],
            )
            span.end()
            context_api.detach(token)

    return wrapper
