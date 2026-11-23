"""Tests for JSON schema validation in the Schema guard."""

import pytest

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


def test_json_mode_allows_parseable_json_even_on_schema_mismatch():
    """json_mode=True skips schema checks once output parses as JSON."""
    result = Schema(
        action="deny", json_mode=True, schema={"type": "integer"}
    ).evaluate('"hello"')

    assert result.action == GuardAction.ALLOW
    assert result.classification == ""


def test_json_mode_still_denies_invalid_json():
    """json_mode=True still rejects output that is not parseable JSON."""
    result = Schema(
        action="deny", json_mode=True, schema={"type": "integer"}
    ).evaluate("not json")

    assert result.action == GuardAction.DENY
    assert result.classification == "invalid_json"


def test_default_mode_still_denies_schema_mismatch():
    """Default json_mode=False keeps schema validation enabled."""
    result = Schema(action="deny", schema={"type": "integer"}).evaluate('"hello"')

    assert result.action == GuardAction.DENY
    assert result.classification == "schema_mismatch"
