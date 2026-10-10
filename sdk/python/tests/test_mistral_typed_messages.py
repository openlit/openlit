# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: Mistral input messages passed as the mistralai SDK's
own message models must be captured.

`chat.complete(messages=[SystemMessage(...), UserMessage(...)])` is a
supported call, but `build_input_messages` called `.get()` on each message,
which the SDK models do not have. Every typed message was dropped with a
logged traceback, so `gen_ai.input.messages` was `[]` while the same prompt
written as dicts was recorded.
"""

import json

from mistralai.client.models import (
    ImageURLChunk,
    SystemMessage,
    TextChunk,
    UserMessage,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral.utils import (
    build_input_messages,
    process_chat_response,
)
from openlit.semcov import SemanticConvention

EXPECTED = [
    {"role": "system", "parts": [{"type": "text", "content": "Be brief."}]},
    {"role": "user", "parts": [{"type": "text", "content": "Monitor LLM apps"}]},
]

RESPONSE = {
    "id": "cmpl-1",
    "model": "mistral-small-latest",
    "choices": [
        {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
    ],
    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
}


def test_typed_messages_match_dict_messages():
    typed = [
        SystemMessage(content="Be brief."),
        UserMessage(content="Monitor LLM apps"),
    ]
    as_dicts = [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "Monitor LLM apps"},
    ]

    assert build_input_messages(as_dicts) == EXPECTED
    assert build_input_messages(typed) == EXPECTED


def test_typed_content_chunks_are_captured():
    message = UserMessage(
        content=[
            TextChunk(text="Describe this"),
            ImageURLChunk(image_url={"url": "https://example.com/cat.png"}),
        ]
    )

    assert build_input_messages([message]) == [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "Describe this"},
                {
                    "type": "uri",
                    "modality": "image",
                    "uri": "https://example.com/cat.png",
                },
            ],
        }
    ]


def test_complete_span_records_typed_messages():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer(__name__)

    with tracer.start_as_current_span("chat") as span:
        process_chat_response(
            response=RESPONSE,
            request_model="mistral-small-latest",
            pricing_info={},
            server_port=443,
            server_address="api.mistral.ai",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            model="mistral-small-latest",
            messages=[
                SystemMessage(content="Be brief."),
                UserMessage(content="Monitor LLM apps"),
            ],
        )

    (finished,) = exporter.get_finished_spans()
    recorded = json.loads(finished.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES])
    assert recorded == EXPECTED
