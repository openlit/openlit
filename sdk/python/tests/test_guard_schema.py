"""Tests for JSON schema validation in the Schema guard."""

import pytest

from openlit.guard._base import GuardAction
from openlit.guard._pipeline import Pipeline
from openlit.guard.schema import Schema


@pytest.mark.parametrize("schema_type", ["integer", "number"])
@pytest.mark.parametrize("value", ["true", "false"])
def test_numeric_schema_rejects_boolean(schema_type, value):
    """JSON booleans must not satisfy integer or number schemas."""
    result = Schema(schema={"type": schema_type}).evaluate(value)

    assert result.action == GuardAction.DENY
    assert result.classification == "schema_mismatch"


@pytest.mark.parametrize("schema_type", ["integer", "number"])
@pytest.mark.parametrize("value", ["0", "1", "-2"])
def test_numeric_schema_accepts_numbers(schema_type, value):
    """Real numeric strings still pass numeric schemas."""
    result = Schema(schema={"type": schema_type}).evaluate(value)

    assert result.action == GuardAction.ALLOW


def test_boolean_schema_accepts_boolean():
    """Boolean schemas keep accepting booleans."""
    result = Schema(schema={"type": "boolean"}).evaluate("true")

    assert result.action == GuardAction.ALLOW


# OpenAI strict structured outputs write an optional field as a union with null.
NULLABLE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "nickname": {"type": ["string", "null"]},
    },
    "required": ["name", "nickname"],
}


@pytest.mark.parametrize(
    "text", ['{"name": "Ada", "nickname": null}', '{"name": "Ada", "nickname": "A"}']
)
def test_type_list_accepts_any_listed_type(text):
    """A value matching any type in a list of types passes."""
    result = Schema(schema=NULLABLE_SCHEMA).evaluate(text)

    assert result.action == GuardAction.ALLOW


@pytest.mark.parametrize("value", ["42", "true", "[]"])
def test_type_list_rejects_other_types(value):
    """A value matching none of the listed types is denied, not raised."""
    text = f'{{"name": "Ada", "nickname": {value}}}'
    result = Schema(schema=NULLABLE_SCHEMA).evaluate(text)

    assert result.action == GuardAction.DENY
    assert result.classification == "schema_mismatch"
    assert "string or null at .nickname" in result.explanation


def test_type_list_still_rejects_boolean_for_numbers():
    """Booleans stay out of numeric types inside a list of types."""
    result = Schema(schema={"type": ["integer", "null"]}).evaluate("true")

    assert result.action == GuardAction.DENY


def test_type_list_checks_nested_objects_and_arrays():
    """Properties and items are still checked when the type is a list."""
    schema = {
        "type": ["object", "null"],
        "properties": {"tags": {"type": ["array", "null"], "items": {"type": "string"}}},
    }

    assert Schema(schema=schema).evaluate("null").action == GuardAction.ALLOW
    assert Schema(schema=schema).evaluate('{"tags": ["a"]}').action == GuardAction.ALLOW
    result = Schema(schema=schema).evaluate('{"tags": ["a", 1]}')
    assert result.action == GuardAction.DENY
    assert "at .tags[1]" in result.explanation


def test_pipeline_denies_type_list_mismatch_instead_of_failing_open():
    """With the default fail_open, the guard must deny rather than raise and allow."""
    result = Pipeline(guards=[Schema(schema=NULLABLE_SCHEMA)]).evaluate(
        '{"name": "Ada", "nickname": 42}', phase="postflight"
    )

    assert result.action == GuardAction.DENY
