# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods
"""
Unit tests for the shared GenAI helpers added to `openlit.__helpers`:

- ``build_system_instructions_from_messages`` — extracts system messages from
  a chat-completions request and normalizes them to the OTel GenAI
  ``[{"type": "text", "content": "..."}]`` schema.
- ``build_tool_definitions`` — extracts tool/function definitions from a chat
  request's ``tools`` parameter and normalizes them to the OTel GenAI
  ``[{"type": "function", "name", "description", "parameters"}]`` schema.

Every Python provider instrumented for ``gen_ai.system_instructions`` and
``gen_ai.tool.definitions`` routes through these helpers, so this single test
file gives broad correctness coverage for the cross-SDK GenAI gap-closure work.
"""

import hashlib
import json
import pytest

from openlit.__helpers import (
    build_system_instructions_from_messages,
    build_tool_definitions,
    compute_agent_version_hash,
)


# ---------------------------------------------------------------------------
# build_system_instructions_from_messages
# ---------------------------------------------------------------------------


class TestBuildSystemInstructionsFromMessages:
    def test_returns_none_for_empty_or_missing_input(self):
        assert build_system_instructions_from_messages(None) is None
        assert build_system_instructions_from_messages([]) is None

    def test_returns_none_when_no_system_role_present(self):
        messages = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        assert build_system_instructions_from_messages(messages) is None

    def test_string_content_dict_message(self):
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "hi"},
        ]
        result = build_system_instructions_from_messages(messages)
        assert result == [{"type": "text", "content": "You are a helpful assistant."}]

    def test_list_of_parts_content(self):
        messages = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": "part 1"},
                    {"type": "text", "text": "part 2"},
                    # Non-text parts are ignored.
                    {"type": "image_url", "image_url": "ignored"},
                    # Bare string parts are also captured.
                    "part 3",
                ],
            }
        ]
        result = build_system_instructions_from_messages(messages)
        assert result == [
            {"type": "text", "content": "part 1"},
            {"type": "text", "content": "part 2"},
            {"type": "text", "content": "part 3"},
        ]

    def test_multiple_system_messages_are_preserved(self):
        messages = [
            {"role": "system", "content": "first"},
            {"role": "user", "content": "noise"},
            {"role": "system", "content": "second"},
        ]
        result = build_system_instructions_from_messages(messages)
        assert result == [
            {"type": "text", "content": "first"},
            {"type": "text", "content": "second"},
        ]

    def test_object_message_with_attribute_access(self):
        class _Msg:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        messages = [_Msg("system", "obj-style"), _Msg("user", "hi")]
        result = build_system_instructions_from_messages(messages)
        assert result == [{"type": "text", "content": "obj-style"}]

    def test_empty_content_is_skipped(self):
        messages = [
            {"role": "system", "content": ""},
            {"role": "system", "content": "non-empty"},
        ]
        result = build_system_instructions_from_messages(messages)
        assert result == [{"type": "text", "content": "non-empty"}]

    def test_non_string_content_is_coerced(self):
        messages = [{"role": "system", "content": 42}]
        result = build_system_instructions_from_messages(messages)
        assert result == [{"type": "text", "content": "42"}]


# ---------------------------------------------------------------------------
# build_tool_definitions
# ---------------------------------------------------------------------------


class TestBuildToolDefinitions:
    def test_returns_none_for_empty_or_missing_input(self):
        assert build_tool_definitions(None) is None
        assert build_tool_definitions([]) is None

    def test_openai_style_function_schema(self):
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get current weather",
                    "parameters": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                    },
                },
            }
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Get current weather",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
            }
        ]

    def test_flat_schema_with_parameters_field(self):
        tools = [
            {
                "name": "search",
                "description": "Search the web",
                "parameters": {"type": "object"},
            }
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "search",
                "description": "Search the web",
                "parameters": {"type": "object"},
            }
        ]

    def test_anthropic_style_input_schema_synonym(self):
        tools = [
            {
                "name": "ping",
                "description": "Anthropic shape",
                "input_schema": {"type": "object"},
            }
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "ping",
                "description": "Anthropic shape",
                "parameters": {"type": "object"},
            }
        ]

    def test_missing_parameters_defaults_to_empty_object(self):
        tools = [{"name": "no_params", "description": "no schema"}]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "no_params",
                "description": "no schema",
                "parameters": {},
            }
        ]

    def test_unnamed_function_is_skipped(self):
        # An OpenAI-style function entry without a name is invalid and should
        # be dropped rather than emitted with an empty name.
        tools = [
            {"type": "function", "function": {"description": "no name"}},
            {"name": "ok"},
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {"type": "function", "name": "ok", "description": "", "parameters": {}}
        ]

    def test_object_tools_with_attribute_access(self):
        class _Func:
            def __init__(self, name, description, parameters):
                self.name = name
                self.description = description
                self.parameters = parameters

        class _Tool:
            def __init__(self, ttype, function):
                self.type = ttype
                self.function = function

        tools = [
            _Tool(
                "function",
                _Func("obj_fn", "object-style", {"type": "object"}),
            )
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "obj_fn",
                "description": "object-style",
                "parameters": {"type": "object"},
            }
        ]

    def test_returns_none_when_all_entries_are_unusable(self):
        # Anything we can't extract a name for must be filtered out, returning
        # None when nothing remains.
        tools = [{"description": "no name"}, {}, None]
        assert build_tool_definitions(tools) is None

    def test_malformed_entries_do_not_short_circuit_others(self):
        tools = [
            {"description": "no name"},
            {"name": "kept", "description": "kept tool"},
        ]
        result = build_tool_definitions(tools)
        assert result == [
            {
                "type": "function",
                "name": "kept",
                "description": "kept tool",
                "parameters": {},
            }
        ]


# ---------------------------------------------------------------------------
# compute_agent_version_hash
# ---------------------------------------------------------------------------


class TestComputeAgentVersionHash:
    """The canonical fingerprint must:
    - be deterministic across calls with identical inputs,
    - be independent of dict key ordering on tool schemas,
    - change when any of {system prompt, tool set, model, runtime config}
      meaningfully changes, and
    - produce the same hex digest that the server-side ``fingerprint()`` in
      ``snapshot.ts`` would for the same canonical inputs.
    """

    BASE_PROMPT = [{"type": "text", "content": "You are a helpful assistant."}]
    BASE_TOOLS = [
        {
            "type": "function",
            "name": "lookup_weather",
            "description": "Look up weather",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        }
    ]

    def _hash(self, **overrides) -> str:
        return compute_agent_version_hash(
            system_instructions=overrides.get("system", self.BASE_PROMPT),
            tool_definitions=overrides.get("tools", self.BASE_TOOLS),
            primary_model=overrides.get("model", "gpt-4o-mini"),
            runtime_config=overrides.get(
                "runtime",
                {"temperature": 0.2, "top_p": 1.0, "max_tokens": 512},
            ),
            providers=overrides.get("providers", ["openai"]),
        )

    def test_deterministic(self):
        assert self._hash() == self._hash()

    def test_short_sha1_format(self):
        h = self._hash()
        assert isinstance(h, str)
        assert len(h) == 16
        int(h, 16)  # parseable as hex

    def test_independent_of_tool_key_order(self):
        reordered = [
            {
                "description": "Look up weather",
                "parameters": {
                    "required": ["city"],
                    "properties": {"city": {"type": "string"}},
                    "type": "object",
                },
                "type": "function",
                "name": "lookup_weather",
            }
        ]
        assert self._hash() == self._hash(tools=reordered)

    def test_independent_of_tool_list_order(self):
        a = [
            {"type": "function", "name": "a", "parameters": {"type": "object"}},
            {"type": "function", "name": "b", "parameters": {"type": "object"}},
        ]
        b = list(reversed(a))
        assert self._hash(tools=a) == self._hash(tools=b)

    def test_independent_of_runtime_config_key_order(self):
        rc1 = {"temperature": 0.2, "top_p": 1.0, "max_tokens": 512}
        rc2 = {"max_tokens": 512, "top_p": 1.0, "temperature": 0.2}
        assert self._hash(runtime=rc1) == self._hash(runtime=rc2)

    def test_sensitive_to_system_prompt(self):
        other = [{"type": "text", "content": "Different system prompt."}]
        assert self._hash() != self._hash(system=other)

    def test_sensitive_to_model(self):
        assert self._hash() != self._hash(model="gpt-4o")

    def test_sensitive_to_temperature(self):
        rc = {"temperature": 0.9, "top_p": 1.0, "max_tokens": 512}
        assert self._hash() != self._hash(runtime=rc)

    def test_sensitive_to_max_tokens(self):
        rc = {"temperature": 0.2, "top_p": 1.0, "max_tokens": 256}
        assert self._hash() != self._hash(runtime=rc)

    def test_sensitive_to_tool_addition(self):
        more = list(self.BASE_TOOLS) + [
            {
                "type": "function",
                "name": "find_hotels",
                "parameters": {"type": "object"},
            }
        ]
        assert self._hash() != self._hash(tools=more)

    def test_whitespace_normalization(self):
        # Server runs `normalizeWhitespace` which collapses runs of whitespace
        # and trims. We mirror that, so a prompt with extra spaces produces
        # the same hash as the trimmed version.
        a = [{"type": "text", "content": "hello   world"}]
        b = [{"type": "text", "content": "hello world"}]
        assert self._hash(system=a) == self._hash(system=b)

    def test_integer_valued_floats_match_javascript(self):
        # JSON.stringify in JS serialises `1.0` as `1`; Python's json.dumps
        # would normally emit `1.0`. The helper coerces integer-valued floats
        # so the encoded payload — and thus the digest — matches the server.
        rc1 = {"temperature": 0.0, "top_p": 1.0, "max_tokens": 100}
        rc2 = {"temperature": 0, "top_p": 1, "max_tokens": 100}
        assert self._hash(runtime=rc1) == self._hash(runtime=rc2)

    def test_cross_language_consistency_with_typescript_sdk(self):
        """Pin the digest produced by a representative agent definition.

        The matching test in
        ``sdk/typescript/src/instrumentation/__tests__/helpers-genai.test.ts``
        feeds the identical canonical inputs through
        ``OpenLitHelper.computeAgentVersionHash`` and asserts the same digest.

        Together the two tests guarantee that an agent emitted by the Python
        SDK and the TypeScript SDK with the same definition produces the
        same ``openlit.agent.version_hash`` value, which is the whole point
        of the helper.
        """
        result = compute_agent_version_hash(
            system_instructions=[{"type": "text", "content": "ping"}],
            tool_definitions=[
                {
                    "type": "function",
                    "name": "echo",
                    "description": "Echo a message",
                    "parameters": {
                        "type": "object",
                        "properties": {"msg": {"type": "string"}},
                    },
                }
            ],
            primary_model="gpt-4o-mini",
            runtime_config={"temperature": 0.0, "top_p": 1.0, "max_tokens": 256},
            providers=["openai"],
        )
        # SHA1 of the canonical-encoded payload, first 16 chars. Pinning the
        # exact digest catches future canonical-format drift across SDKs.
        assert result == "040e364c33aa3dde"

    def test_known_canonical_payload(self):
        # Lock in the exact payload shape the server `fingerprint()` consumes,
        # so any future canonicalization change has to be a deliberate edit
        # rather than an accidental drift.
        payload = {
            "cfg": {
                "max_tokens": 512,
                "provider": "openai",
                "temperature": 0.2,
                "top_p": 1,
            },
            "model": "gpt-4o-mini",
            "sp": json.dumps(
                [{"type": "text", "content": "You are a helpful assistant."}],
                separators=(",", ":"),
                ensure_ascii=False,
            ),
            "tools": [
                {
                    "n": "lookup_weather",
                    "s": {
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                        "type": "object",
                    },
                }
            ],
        }
        encoded = json.dumps(
            payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True
        )
        expected = hashlib.sha1(encoded.encode("utf-8")).hexdigest()[:16]
        assert self._hash() == expected


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
