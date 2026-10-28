"""Strict JSON validation at the public Schema guard and pipeline boundary."""

import pytest

from openlit.guard._base import GuardAction
from openlit.guard._pipeline import Pipeline
from openlit.guard.schema import Schema


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("template", ["{}", '{{"score": {}}}', '[1, {{"score": {}}}]'])
def test_non_json_constants_are_denied(constant, template):
    """Non-standard numeric literals must not pass the postflight JSON guard."""
    text = template.format(constant)
    result = Pipeline(guards=[Schema(json_mode=True)]).evaluate(text, phase="postflight")

    assert result.action == GuardAction.DENY
    assert result.results[0].classification == "invalid_json"
    assert constant in result.results[0].explanation


@pytest.mark.parametrize(
    "text",
    [
        "null", "true", "42", "-1.25e3", '"NaN"',
        '{"NaN": "Infinity", "values": [0, -1, 2.5, null]}',
    ],
)
def test_standard_json_remains_allowed(text):
    """Strings and keys containing reserved spellings are ordinary JSON data."""
    result = Schema(json_mode=True).evaluate(text)
    assert result.action == GuardAction.ALLOW


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_non_json_constants_respect_warn_action(constant):
    """Invalid syntax retains the caller's configured guard action."""
    result = Schema(action="warn", schema={"type": "number"}).evaluate(constant)
    assert result.action == GuardAction.WARN
    assert result.classification == "invalid_json"
