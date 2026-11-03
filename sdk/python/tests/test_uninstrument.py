# pylint: disable=missing-function-docstring
"""Regression tests: `uninstrument()` must remove the wrappers it installed.

`_uninstrument` was `pass` for OpenAI, Anthropic and Bedrock, so calls kept
being traced, and instrumenting again stacked a second wrapper on every
method: two nested spans per OpenAI call, and Bedrock `converse_stream`
returning a response whose `stream` the app could no longer read.
"""

import pytest
from wrapt import BaseObjectProxy

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import AnthropicInstrumentor
from openlit.instrumentation.bedrock import BedrockInstrumentor
from openlit.instrumentation.openai import OpenAIInstrumentor


@pytest.fixture(autouse=True)
def _config():
    OpenlitConfig.reset_to_defaults()


def _wrapper_depth(func):
    depth = 0
    while isinstance(func, BaseObjectProxy):
        depth += 1
        func = func.__wrapped__
    return depth


def _openai_target():
    from openai.resources.chat.completions import Completions

    return Completions, "create"


def _anthropic_target():
    from anthropic.resources.messages import AsyncMessages

    return AsyncMessages, "stream"


def _bedrock_target():
    from botocore.client import ClientCreator

    return ClientCreator, "create_client"


@pytest.mark.parametrize(
    "instrumentor_cls, target, layers",
    [
        (OpenAIInstrumentor, _openai_target, 1),
        (AnthropicInstrumentor, _anthropic_target, 1),
        # Bedrock stacks a converse and a converse_stream wrapper.
        (BedrockInstrumentor, _bedrock_target, 2),
    ],
)
def test_uninstrument_removes_wrappers(instrumentor_cls, target, layers):
    owner, name = target()
    instrumentor = instrumentor_cls()
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()
    assert _wrapper_depth(getattr(owner, name)) == 0

    for _ in range(2):
        instrumentor.instrument()
        assert _wrapper_depth(getattr(owner, name)) == layers
        instrumentor.uninstrument()
        assert _wrapper_depth(getattr(owner, name)) == 0
