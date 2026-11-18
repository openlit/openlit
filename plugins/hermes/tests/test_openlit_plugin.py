"""Fake-payload tests for the OpenLIT Hermes plugin.

Payload shapes follow Hermes's observer hook contract (hermes.observer.v1). Users get the
released SDK, so also run these against the plugin.yaml floor, not only the repo's SDK:

    uv run --no-project --with 'openlit==1.45.0' --with pytest pytest plugins/hermes/tests
"""

import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest
from openlit.semcov import SemanticConvention as SC
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode

spec = importlib.util.spec_from_file_location(
    "openlit_hermes_plugin", Path(__file__).parent.parent / "__init__.py"
)
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)

USAGE = {
    "input_tokens": 100,
    "output_tokens": 50,
    "cache_read_tokens": 20,
    "cache_write_tokens": 5,
    "reasoning_tokens": 7,
    "prompt_tokens": 125,
    "total_tokens": 175,
}
REQUEST = {"method": "POST", "body": {
    "system": "secret system prompt",
    "messages": [{"role": "user", "content": "secret prompt"}],
}}
RESPONSE = {"assistant_message": {"role": "assistant", "content": "secret answer"}}
CONTENT_ATTRIBUTES = (
    SC.GEN_AI_INPUT_MESSAGES,
    SC.GEN_AI_OUTPUT_MESSAGES,
    SC.GEN_AI_SYSTEM_INSTRUCTIONS,
    SC.GEN_AI_TOOL_CALL_ARGUMENTS,
    SC.GEN_AI_TOOL_CALL_RESULT,
)


def make_observer(capture_content=False):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    observer = plugin.Observer(provider, capture_content)
    observer.scheduled = []
    observer.schedule = lambda delay_s, callback, **kwargs: observer.scheduled.append(
        (delay_s, callback, kwargs)
    )
    return observer, exporter


def run_scheduled(observer):
    for _, callback, kwargs in observer.scheduled:
        callback(**kwargs)


def llm_payload(**overrides):
    return {
        "session_id": "s1",
        "turn_id": "t1",
        "api_request_id": "r1",
        "model": "gpt-5",
        "provider": "openai",
        "base_url": "https://user:pw@api.openai.com/v1",
        "started_at": 1000.0,
        "ended_at": 1002.5,
        "finish_reason": "stop",
        "response_model": "gpt-5-2026",
        "usage": USAGE,
        "request": REQUEST,
        "response": RESPONSE,
        **overrides,
    }


def tool_payload(**overrides):
    return {
        "session_id": "s1",
        "turn_id": "t1",
        "tool_name": "terminal",
        "tool_call_id": "c1",
        "args": {"command": "secret ls"},
        "result": "secret output",
        "duration_ms": 250,
        "status": "ok",
        "error_type": None,
        "error_message": None,
        **overrides,
    }


def run_turn(observer):
    observer.turn_start(
        session_id="s1", turn_id="t1", model="gpt-5", platform="cli", user_message="secret prompt"
    )
    if observer.capture_content:
        observer.llm_request(turn_id="t1", api_request_id="r1", request=REQUEST)
    observer.llm_call(**llm_payload())
    observer.tool_call(**tool_payload())
    if observer.capture_content:
        observer.turn_output(turn_id="t1", assistant_response="secret answer")
    observer.turn_end(session_id="s1", turn_id="t1", completed=True, turn_exit_reason="done")


def by_name(exporter):
    return {span.name: span for span in exporter.get_finished_spans()}


def test_turn_is_parent_of_llm_and_tool_spans():
    observer, exporter = make_observer()
    run_turn(observer)

    spans = by_name(exporter)
    turn, llm, tool = spans["invoke_agent hermes"], spans["chat gpt-5"], spans["execute_tool terminal"]
    assert turn.parent is None
    assert llm.parent.span_id == turn.context.span_id
    assert tool.parent.span_id == turn.context.span_id
    assert {span.context.trace_id for span in spans.values()} == {turn.context.trace_id}
    assert turn.attributes[SC.GEN_AI_OPERATION] == "invoke_agent"
    assert turn.attributes[SC.GEN_AI_AGENT_NAME] == "hermes"
    assert turn.attributes[SC.GEN_AI_REQUEST_MODEL] == "gpt-5"
    assert turn.attributes["hermes.platform"] == "cli"
    assert turn.attributes["hermes.turn.exit_reason"] == "done"
    assert turn.status.status_code == StatusCode.UNSET
    for span in spans.values():
        assert span.attributes[SC.GEN_AI_CONVERSATION_ID] == "s1"
    assert observer.turns == {}


def test_llm_span_attributes_and_cost():
    observer, exporter = make_observer()
    observer.pricing = {"chat": {"gpt-5-2026": {"promptPrice": 1.0, "completionPrice": 2.0}}}
    observer.llm_call(**llm_payload())

    span = by_name(exporter)["chat gpt-5"]
    attributes = span.attributes
    assert span.kind == SpanKind.CLIENT
    assert span.start_time == 1_000_000_000_000
    assert span.end_time == 1_002_500_000_000
    assert attributes[SC.GEN_AI_OPERATION] == "chat"
    assert attributes[SC.GEN_AI_PROVIDER_NAME] == "openai"
    assert attributes[SC.GEN_AI_RESPONSE_MODEL] == "gpt-5-2026"
    assert attributes[SC.GEN_AI_RESPONSE_FINISH_REASON] == ("stop",)
    assert attributes[SC.SERVER_ADDRESS] == "api.openai.com"
    assert attributes[SC.GEN_AI_USAGE_INPUT_TOKENS] == 125
    assert attributes[SC.GEN_AI_USAGE_OUTPUT_TOKENS] == 50
    assert attributes[SC.GEN_AI_USAGE_TOTAL_TOKENS] == 175
    assert attributes[SC.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == 20
    assert attributes[SC.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == 5
    assert attributes[SC.GEN_AI_USAGE_REASONING_TOKENS] == 7
    assert attributes[SC.GEN_AI_USAGE_COST] == pytest.approx(0.125 * 1.0 + 0.05 * 2.0)


def test_llm_call_outside_a_turn_is_a_root_span_without_usage_attributes():
    observer, exporter = make_observer()
    observer.llm_call(**llm_payload(turn_id="", usage=None))

    span = by_name(exporter)["chat gpt-5"]
    assert span.parent is None
    assert SC.GEN_AI_USAGE_INPUT_TOKENS not in span.attributes
    assert SC.GEN_AI_USAGE_COST not in span.attributes


def test_content_is_not_captured_by_default():
    observer, exporter = make_observer()
    run_turn(observer)

    for span in exporter.get_finished_spans():
        assert not set(CONTENT_ATTRIBUTES) & set(span.attributes)
        assert "secret" not in json.dumps(dict(span.attributes), default=str)
    assert "pre_api_request" not in observer.hooks()
    assert "post_llm_call" not in observer.hooks()


def test_content_is_captured_when_enabled():
    observer, exporter = make_observer(capture_content=True)
    run_turn(observer)

    spans = by_name(exporter)
    turn, llm, tool = spans["invoke_agent hermes"], spans["chat gpt-5"], spans["execute_tool terminal"]
    for span in (turn, llm):
        input_messages = json.loads(span.attributes[SC.GEN_AI_INPUT_MESSAGES])
        output_messages = json.loads(span.attributes[SC.GEN_AI_OUTPUT_MESSAGES])
        assert input_messages[0]["role"] == "user"
        assert input_messages[0]["parts"][0]["content"] == "secret prompt"
        assert output_messages[0]["parts"][0]["content"] == "secret answer"
    assert json.loads(tool.attributes[SC.GEN_AI_TOOL_CALL_ARGUMENTS]) == {"command": "secret ls"}
    assert tool.attributes[SC.GEN_AI_TOOL_CALL_RESULT] == "secret output"
    assert {"pre_api_request", "post_llm_call"} <= set(observer.hooks())


def test_failed_tool_sets_error_without_leaking_the_message():
    observer, exporter = make_observer()
    observer.tool_call(
        **tool_payload(status="error", error_type="tool_error", error_message="secret failure")
    )

    span = by_name(exporter)["execute_tool terminal"]
    assert span.status.status_code == StatusCode.ERROR
    assert span.status.description == "tool_error"
    assert span.attributes[SC.ERROR_TYPE] == "tool_error"
    assert (span.end_time - span.start_time) == 250_000_000


@pytest.mark.parametrize("status", ["blocked", "cancelled"])
def test_blocked_and_cancelled_tools_are_recorded_but_not_errors(status):
    observer, exporter = make_observer()
    observer.tool_call(**tool_payload(status=status))

    span = by_name(exporter)["execute_tool terminal"]
    assert span.attributes["hermes.tool.status"] == status
    assert span.status.status_code == StatusCode.UNSET


def test_api_request_error_marks_the_llm_span_failed():
    observer, exporter = make_observer()
    observer.llm_call(
        **llm_payload(
            usage=None,
            response=None,
            finish_reason=None,
            status_code=429,
            reason="rate_limit",
            error={"type": "RateLimitError", "message": "secret provider body"},
        )
    )

    span = by_name(exporter)["chat gpt-5"]
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[SC.ERROR_TYPE] == "RateLimitError"
    assert "secret" not in str(span.status.description)


def test_auxiliary_call_is_an_llm_span_with_its_task():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1", model="gpt-5")
    observer.llm_call(**llm_payload(aux_task="compression", request=None, response=None))
    observer.turn_end(turn_id="t1")

    spans = by_name(exporter)
    assert spans["chat gpt-5"].attributes["hermes.auxiliary_task"] == "compression"
    assert spans["chat gpt-5"].parent.span_id == spans["invoke_agent hermes"].context.span_id


def test_auxiliary_call_error_string_uses_error_type():
    observer, exporter = make_observer()
    observer.llm_call(**llm_payload(error="Timeout: secret", error_type="Timeout"))

    assert by_name(exporter)["chat gpt-5"].attributes[SC.ERROR_TYPE] == "Timeout"


def test_failed_and_interrupted_turns_still_end():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.turn_end(turn_id="t1", failed=True, turn_exit_reason="max_iterations")
    observer.turn_start(session_id="s1", turn_id="t2")
    observer.turn_end(turn_id="t2", interrupted=True, turn_exit_reason="interrupted")

    failed, interrupted = exporter.get_finished_spans()
    assert failed.status.status_code == StatusCode.ERROR
    assert failed.attributes[SC.ERROR_TYPE] == "max_iterations"
    assert interrupted.status.status_code == StatusCode.UNSET
    assert interrupted.attributes["hermes.turn.interrupted"] is True


def failed_api_call(**overrides):
    return llm_payload(**{
        "usage": None,
        "response": None,
        "finish_reason": None,
        "status_code": 401,
        "retryable": False,
        "reason": "auth",
        "error": {"type": "AuthenticationError", "message": "secret provider body"},
        **overrides,
    })


def test_turn_hermes_never_ends_closes_as_failed_when_the_next_turn_starts():
    # Hermes skips on_session_end when it stops on an API error it won't retry.
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())
    assert [span.name for span in exporter.get_finished_spans()] == ["chat gpt-5"]

    observer.turn_start(session_id="s1", turn_id="t2")

    failed = by_name(exporter)["invoke_agent hermes"]
    assert failed.status.status_code == StatusCode.ERROR
    assert failed.attributes[SC.ERROR_TYPE] == "AuthenticationError"
    assert failed.attributes["hermes.turn.exit_reason"] == "abandoned"
    assert failed.end_time == int(1002.5 * 1e9)
    assert list(observer.turns) == ["t2"]


def test_non_retryable_error_closes_an_idle_turn_after_the_delay():
    # A gateway fires no session hook for such a turn, so a timer is the only signal.
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())

    ((delay_s, _, _),) = observer.scheduled
    assert delay_s == plugin.ABANDON_AFTER_S
    run_scheduled(observer)

    turn = by_name(exporter)["invoke_agent hermes"]
    assert turn.status.status_code == StatusCode.ERROR
    assert turn.attributes["hermes.turn.exit_reason"] == "abandoned"
    assert observer.turns == {}


def test_a_fallback_call_before_the_delay_keeps_the_turn_open():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())
    observer.llm_call(**llm_payload(api_request_id="r2", ended_at=1003.0))

    run_scheduled(observer)

    assert "invoke_agent hermes" not in by_name(exporter)
    observer.turn_end(turn_id="t1", turn_exit_reason="done")
    assert by_name(exporter)["invoke_agent hermes"].status.status_code == StatusCode.UNSET


def test_retryable_errors_schedule_nothing():
    observer, _ = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call(retryable=True))

    assert observer.scheduled == []


def test_the_real_timer_closes_the_turn():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    observer = plugin.Observer(provider)
    observer.abandon_after_s = 0.01
    observer.flush = lambda: None
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())

    for thread in threading.enumerate():
        if thread.name == "openlit-abandon":
            thread.join(timeout=2)
    assert [span.name for span in exporter.get_finished_spans()][-1] == "invoke_agent hermes"



    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.turn_start(session_id="s2", turn_id="t2")

    assert exporter.get_finished_spans() == ()
    assert set(observer.turns) == {"t1", "t2"}


def test_session_finalize_closes_its_open_turns():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.turn_start(session_id="s2", turn_id="t2")

    observer.session_finalize(session_id="s1", platform="cli", reason="shutdown")

    (closed,) = exporter.get_finished_spans()
    assert closed.attributes[SC.GEN_AI_CONVERSATION_ID] == "s1"
    assert closed.attributes["hermes.turn.exit_reason"] == "abandoned"
    assert closed.status.status_code == StatusCode.UNSET
    assert list(observer.turns) == ["t2"]


def test_a_successful_fallback_call_clears_the_turn_error():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())
    observer.llm_call(**llm_payload(api_request_id="r2", model="fallback-model"))

    observer.session_finalize(session_id="s1")

    assert by_name(exporter)["invoke_agent hermes"].status.status_code == StatusCode.UNSET


def test_close_all_ends_every_open_turn_and_flushes():
    observer, exporter = make_observer()
    flushed = []
    observer.flush = lambda: flushed.append(True)
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.llm_call(**failed_api_call())

    observer.close_all()

    assert by_name(exporter)["invoke_agent hermes"].status.status_code == StatusCode.ERROR
    assert observer.turns == {}
    assert flushed == [True]


def test_close_all_without_open_turns_skips_the_flush():
    observer, _ = make_observer()
    observer.flush = lambda: pytest.fail("nothing to flush")
    observer.close_all()


def test_on_session_end_after_an_abandoned_close_is_a_no_op():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    observer.session_finalize(session_id="s1")
    observer.turn_end(turn_id="t1", failed=True, turn_exit_reason="late")

    (turn,) = exporter.get_finished_spans()
    assert turn.attributes["hermes.turn.exit_reason"] == "abandoned"


def test_tool_call_only_response_records_the_requested_calls():
    observer, exporter = make_observer(capture_content=True)
    tool_call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "read_file", "arguments": '{"path": "notes.txt"}'},
    }
    observer.llm_call(**llm_payload(
        finish_reason="tool_calls",
        response={"assistant_message": {"role": "assistant", "content": None,
                                        "tool_calls": [tool_call]}},
    ))

    output = json.loads(by_name(exporter)["chat gpt-5"].attributes[SC.GEN_AI_OUTPUT_MESSAGES])
    assert output == [{
        "role": "assistant",
        "parts": [{"type": "tool_call", "id": "call_1", "name": "read_file",
                   "arguments": {"path": "notes.txt"}}],
        "finish_reason": "tool_calls",
    }]


def test_input_messages_keep_tool_calls_and_tool_results():
    observer, exporter = make_observer(capture_content=True)
    request = {"method": "POST", "body": {"messages": [
        {"role": "user", "content": "read it"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "call_1", "function": {"name": "read_file", "arguments": "not json"}},
        ]},
        {"role": "tool", "tool_call_id": "call_1", "content": "file body"},
    ]}}
    observer.llm_call(**llm_payload(request=request))

    messages = json.loads(by_name(exporter)["chat gpt-5"].attributes[SC.GEN_AI_INPUT_MESSAGES])
    assert messages[0] == {"role": "user", "parts": [{"type": "text", "content": "read it"}]}
    assert messages[1]["parts"] == [{"type": "tool_call", "id": "call_1", "name": "read_file",
                                     "arguments": {"raw": "not json"}}]
    assert messages[2] == {"role": "tool", "parts": [
        {"type": "tool_call_response", "id": "call_1", "response": "file body"}
    ]}


def test_anthropic_content_blocks_become_message_parts():
    # The request shape Hermes sends to Anthropic: content blocks, tool results as user blocks.
    observer, exporter = make_observer(capture_content=True)
    request = {"method": "POST", "body": {"system": [
        {"type": "text", "text": "You are Hermes.", "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "Be brief."},
    ], "messages": [
        {"role": "user", "content": [
            {"type": "text", "text": "read it", "cache_control": {"type": "ephemeral"}},
            {"type": "image", "source": {"type": "base64", "data": "aGVsbG8="}},
        ]},
        {"role": "assistant", "content": [
            {"type": "thinking", "thinking": "need the file", "signature": "sig"},
            {"type": "tool_use", "id": "toolu_1", "name": "read_file", "input": {"path": "a.txt"}},
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_1",
             "content": [{"type": "text", "text": "file body"}]},
        ]},
    ]}}
    observer.llm_call(**llm_payload(request=request))

    attributes = by_name(exporter)["chat gpt-5"].attributes
    assert json.loads(attributes[SC.GEN_AI_SYSTEM_INSTRUCTIONS]) == [
        {"type": "text", "content": "You are Hermes."},
        {"type": "text", "content": "Be brief."},
    ]
    messages = json.loads(attributes[SC.GEN_AI_INPUT_MESSAGES])
    assert messages == [
        {"role": "user", "parts": [{"type": "text", "content": "read it"}, {"type": "image"}]},
        {"role": "assistant", "parts": [
            {"type": "reasoning", "content": "need the file"},
            {"type": "tool_call", "id": "toolu_1", "name": "read_file",
             "arguments": {"path": "a.txt"}},
        ]},
        {"role": "user", "parts": [
            {"type": "tool_call_response", "id": "toolu_1", "response": "file body"},
        ]},
    ]


def test_responses_instructions_are_system_instructions():
    observer, exporter = make_observer(capture_content=True)
    request = {"method": "POST", "body": {"instructions": "You are Hermes.", "input": [
        {"role": "user", "content": "hi"},
    ]}}
    observer.llm_call(**llm_payload(request=request))

    attributes = by_name(exporter)["chat gpt-5"].attributes
    assert json.loads(attributes[SC.GEN_AI_SYSTEM_INSTRUCTIONS]) == [
        {"type": "text", "content": "You are Hermes."}
    ]


def test_system_prompt_in_messages_adds_no_system_instructions():
    observer, exporter = make_observer(capture_content=True)
    request = {"method": "POST", "body": {"messages": [
        {"role": "system", "content": "You are Hermes."},
        {"role": "user", "content": "hi"},
    ]}}
    observer.llm_call(**llm_payload(request=request))

    attributes = by_name(exporter)["chat gpt-5"].attributes
    assert SC.GEN_AI_SYSTEM_INSTRUCTIONS not in attributes
    assert json.loads(attributes[SC.GEN_AI_INPUT_MESSAGES])[0]["role"] == "system"


def test_subagent_turn_joins_the_parent_trace():
    observer, exporter = make_observer()
    observer.turn_start(session_id="parent", turn_id="t1")
    observer.subagent_start(parent_turn_id="t1", child_session_id="child")
    observer.turn_start(session_id="child", turn_id="t2")
    observer.turn_end(turn_id="t2")
    observer.subagent_stop(child_session_id="child")
    observer.turn_end(turn_id="t1")

    child, parent = exporter.get_finished_spans()
    assert child.parent.span_id == parent.context.span_id
    assert child.context.trace_id == parent.context.trace_id
    assert observer.subagent_parents == {}


def test_parallel_tools_on_worker_threads_share_the_turn():
    observer, exporter = make_observer()
    observer.turn_start(session_id="s1", turn_id="t1")
    threads = [
        threading.Thread(target=observer.tool_call, kwargs=tool_payload(tool_call_id=str(index)))
        for index in range(20)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    observer.turn_end(turn_id="t1")

    *tools, turn = exporter.get_finished_spans()
    assert len(tools) == 20
    assert {span.parent.span_id for span in tools} == {turn.context.span_id}


class BrokenProvider:
    def get_tracer(self, *args, **kwargs):
        return self

    def start_span(self, *args, **kwargs):
        raise RuntimeError("exporter exploded")


@pytest.mark.parametrize(
    "hook", list(plugin.Observer(BrokenProvider(), capture_content=True).hooks())
)
def test_hooks_fail_open_on_tracer_errors(hook):
    callback = plugin.Observer(BrokenProvider(), capture_content=True).hooks()[hook]
    assert plugin.fail_open(callback)(session_id="s1", turn_id="t1") is None


@pytest.mark.parametrize(
    "hook", list(plugin.Observer(BrokenProvider(), capture_content=True).hooks())
)
def test_hooks_fail_open_on_malformed_payloads(hook):
    observer, _ = make_observer(capture_content=True)
    observer.turn_start(turn_id="t1")
    payload = {"turn_id": "t1", "usage": "nope", "request": 7, "response": 7, "started_at": "x"}
    assert plugin.fail_open(observer.hooks()[hook])(**payload) is None


def test_fail_open_never_returns_a_value():
    # A pre_llm_call return value would be injected into the user's message.
    assert plugin.fail_open(lambda **_: "injected")(session_id="s1") is None


class SlowExporter(SpanExporter):
    def __init__(self):
        self.release = threading.Event()

    def export(self, spans):
        self.release.wait(5)
        return SpanExportResult.SUCCESS


def test_hooks_do_not_wait_for_a_slow_exporter():
    exporter = SlowExporter()
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(exporter, schedule_delay_millis=1))
    observer = plugin.Observer(provider)

    started = time.monotonic()
    for index in range(200):
        observer.turn_start(session_id="s1", turn_id=str(index))
        observer.llm_call(**llm_payload(turn_id=str(index)))
        observer.turn_end(turn_id=str(index))
    elapsed = time.monotonic() - started

    exporter.release.set()
    provider.shutdown()
    assert elapsed < 2


def test_turn_end_flushes_without_waiting_for_the_batch_timer():
    # A gateway stopped inside the batch delay exits without flushing, losing the turn.
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(exporter, schedule_delay_millis=60_000))
    observer = plugin.Observer(provider)
    run_turn(observer)

    deadline = time.monotonic() + 2
    while len(exporter.get_finished_spans()) < 3 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(exporter.get_finished_spans()) == 3


def test_turn_end_survives_a_failing_flush():
    class BrokenFlushProvider(TracerProvider):
        def force_flush(self, timeout_millis=30000):
            raise RuntimeError("exporter exploded")

    unhandled = []
    original_hook, threading.excepthook = threading.excepthook, unhandled.append
    try:
        observer = plugin.Observer(BrokenFlushProvider())
        run_turn(observer)
        for thread in threading.enumerate():
            if thread.name == "openlit-flush":
                thread.join()
    finally:
        threading.excepthook = original_hook
    assert unhandled == []


class FakeContext:
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, callback):
        self.hooks[name] = callback


@pytest.fixture
def clean_env(monkeypatch):
    for name in (
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_HEADERS",
        "OTEL_SERVICE_NAME",
        "OTEL_DEPLOYMENT_ENVIRONMENT",
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
        "OPENLIT_URL",
        "OPENLIT_API_KEY",
        "OPENLIT_ENVIRONMENT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(plugin, "fetch_pricing_info", lambda *_: {})
    return monkeypatch


@pytest.fixture
def exit_handlers(clean_env):
    handlers = []
    clean_env.setattr(plugin.atexit, "register", handlers.append)
    return handlers


@pytest.fixture
def setup_calls(clean_env, exit_handlers):
    calls = []
    tracer_stub = TracerProvider().get_tracer("test")

    def fake_setup_tracing(**kwargs):
        calls.append(kwargs)
        return tracer_stub

    clean_env.setattr(plugin, "setup_tracing", fake_setup_tracing)
    return calls


def test_register_without_an_endpoint_adds_no_hooks(setup_calls):
    ctx = FakeContext()
    plugin.register(ctx)

    assert ctx.hooks == {}
    assert setup_calls == []


def test_register_uses_otlp_env_with_batching(setup_calls, clean_env):
    clean_env.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    clean_env.setenv("OTEL_SERVICE_NAME", "support-agent")
    clean_env.setenv("OPENLIT_ENVIRONMENT", "staging")
    ctx = FakeContext()
    plugin.register(ctx)

    assert setup_calls[0]["otlp_endpoint"] == "http://collector:4318"
    assert setup_calls[0]["application_name"] == "support-agent"
    assert setup_calls[0]["environment"] == "staging"
    assert setup_calls[0]["otlp_headers"] is None
    assert setup_calls[0]["disable_batch"] is False
    assert "post_tool_call" in ctx.hooks
    assert "pre_tool_call" not in ctx.hooks
    assert "pre_api_request" not in ctx.hooks


def test_register_closes_open_turns_at_exit(setup_calls, exit_handlers, clean_env):
    clean_env.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    ctx = FakeContext()
    plugin.register(ctx)

    assert "on_session_finalize" in ctx.hooks
    # Last registered, so it runs before the tracer provider's own shutdown.
    assert exit_handlers[-1].__name__ == "close_all"
    assert exit_handlers[-1]() is None


def test_register_falls_back_to_openlit_env(setup_calls, clean_env):
    clean_env.setenv("OPENLIT_URL", "https://openlit.example.com")
    clean_env.setenv("OPENLIT_API_KEY", "key")
    clean_env.setenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true")
    ctx = FakeContext()
    plugin.register(ctx)

    assert setup_calls[0]["otlp_endpoint"] == "https://openlit.example.com"
    assert setup_calls[0]["otlp_headers"] == "Authorization=Bearer key"
    assert setup_calls[0]["application_name"] == "hermes-agent"
    assert setup_calls[0]["environment"] == "default"
    assert "pre_api_request" in ctx.hooks


def test_explicit_otlp_headers_win_over_the_api_key(setup_calls, clean_env):
    clean_env.setenv("OPENLIT_URL", "https://openlit.example.com")
    clean_env.setenv("OPENLIT_API_KEY", "key")
    clean_env.setenv("OTEL_EXPORTER_OTLP_HEADERS", "x-openlit-api-key=other")
    plugin.register(FakeContext())

    assert setup_calls[0]["otlp_headers"] is None


def test_register_stays_disabled_when_tracing_setup_fails(clean_env):
    clean_env.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    clean_env.setattr(plugin, "setup_tracing", lambda **_: None)
    ctx = FakeContext()
    plugin.register(ctx)

    assert ctx.hooks == {}
