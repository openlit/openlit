import json

from openlit.instrumentation.langgraph.utils import (
    _process_invoke_response,
    extract_llm_info_from_result,
    get_message_role,
)
from openlit.semcov import SemanticConvention


class SpanStub:
    def __init__(self):
        self.attributes = {}

    def set_attribute(self, key, value):
        self.attributes[key] = value


class TypedMessage:
    def __init__(self, message_type, content):
        self.type = message_type
        self.content = content


class HumanMessage:
    def __init__(self, content):
        self.content = content


class AIMessageChunk:
    def __init__(self, content):
        self.content = content


def test_get_message_role_normalizes_langchain_roles():
    assert get_message_role(TypedMessage("human", "hello")) == "user"
    assert get_message_role(TypedMessage("ai", "hi")) == "assistant"
    assert get_message_role(TypedMessage("function", "tool payload")) == "tool"


def test_get_message_role_normalizes_message_class_names():
    assert get_message_role(HumanMessage("hello")) == "user"
    assert get_message_role(AIMessageChunk("hi")) == "assistant"


def test_extract_llm_info_from_result_skips_non_assistant_outputs():
    span = SpanStub()
    state = {
        "messages": [
            TypedMessage("human", "hello"),
            TypedMessage("system", "follow policy"),
        ]
    }
    result = {"messages": [TypedMessage("human", "not assistant output")]}

    extract_llm_info_from_result(span, state, result)

    input_messages = json.loads(span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES])
    assert [message["role"] for message in input_messages] == ["user", "system"]
    assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in span.attributes


def test_process_invoke_response_keeps_only_assistant_outputs():
    span = SpanStub()
    response = {
        "messages": [
            TypedMessage("human", "question"),
            TypedMessage("ai", "answer"),
        ]
    }

    _process_invoke_response(span, response, capture_message_content=True)

    output_messages = json.loads(
        span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    )
    assert output_messages == [{"role": "assistant", "content": "answer"}]
