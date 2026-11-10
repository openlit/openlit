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
