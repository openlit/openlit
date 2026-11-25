"""Tests for JSON schema validation in the Schema guard."""

import pytest

from openlit.guard import Pipeline
from openlit.guard._base import GuardAction
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


@pytest.mark.parametrize("value", ["1.0", "-2.0", "0.0", "-0.0", "1e1"])
def test_integer_schema_accepts_integral_numeric_representations(value):
    """A JSON Schema integer depends on the value, not its numeric spelling."""
    result = Schema(schema={"type": "integer"}).evaluate(value)

    assert result.action == GuardAction.ALLOW


@pytest.mark.parametrize("value", ["1.5", "-2.25", '"1.0"', "true", "false", "null"])
def test_integer_schema_rejects_non_integer_values(value):
    """Fractional numbers and other JSON primitive types remain invalid."""
    result = Schema(schema={"type": "integer"}).evaluate(value)

    assert result.action == GuardAction.DENY
    assert result.classification == "schema_mismatch"


@pytest.mark.parametrize(
    "schema, output",
    [
        (
            {"type": "object", "properties": {"attempts": {"type": "integer"}}},
            '{"attempts": 1.0}',
        ),
        ({"type": "array", "items": {"type": "integer"}}, "[1.0, -2.0, 3]"),
    ],
)
def test_integer_representations_work_in_postflight_pipeline(schema, output):
    """Structured agent outputs should pass the same checks at nested paths."""
    result = Pipeline(guards=[Schema(schema=schema)]).evaluate(output, phase="postflight")

    assert result.action == GuardAction.ALLOW
