"""Tests for openlit.evaluate_rule() function."""

from unittest.mock import patch, MagicMock


def test_evaluate_rule_exists():
    """evaluate_rule is importable from openlit."""
    from openlit import evaluate_rule
    assert callable(evaluate_rule)


@patch("openlit.requests.post")
def test_evaluate_rule_success(mock_post):
    """Returns parsed JSON on successful response."""
    from openlit import evaluate_rule

    mock_response = MagicMock()
    mock_response.json.return_value = {
        "matchingRuleIds": ["rule-1"],
        "entities": [
            {"rule_id": "rule-1", "entity_type": "context", "entity_id": "ctx-1"}
        ],
    }
    mock_response.raise_for_status = MagicMock()
    mock_post.return_value = mock_response

    result = evaluate_rule(
        url="http://localhost:3000",
        api_key="test-key",
        entity_type="context",
        fields={"gen_ai.system": "openai"},
    )

    assert result is not None
    assert result["matchingRuleIds"] == ["rule-1"]
    assert len(result["entities"]) == 1

    # Verify the request was made correctly
    mock_post.assert_called_once()
    call_args = mock_post.call_args
    assert call_args[0][0] == "http://localhost:3000/api/rule-engine/evaluate"
    assert call_args[1]["headers"]["Authorization"] == "Bearer test-key"
    payload = call_args[1]["json"]
    assert payload["entity_type"] == "context"
    assert payload["fields"] == {"gen_ai.system": "openai"}
    assert payload["source"] == "python-sdk"


@patch("openlit.requests.post")
def test_evaluate_rule_strips_none_values(mock_post):
    """None values are removed from payload."""
    from openlit import evaluate_rule

    mock_response = MagicMock()
    mock_response.json.return_value = {"matchingRuleIds": []}
    mock_response.raise_for_status = MagicMock()
    mock_post.return_value = mock_response

    evaluate_rule(
        url="http://localhost:3000",
        api_key="test-key",
        entity_type="context",
        fields={"key": "val"},
        entity_inputs=None,
    )

    payload = mock_post.call_args[1]["json"]
    assert "entity_inputs" not in payload


@patch("openlit.requests.post")
def test_evaluate_rule_includes_entity_data(mock_post):
    """include_entity_data is passed through."""
    from openlit import evaluate_rule

    mock_response = MagicMock()
    mock_response.json.return_value = {"matchingRuleIds": [], "entity_data": {}}
    mock_response.raise_for_status = MagicMock()
    mock_post.return_value = mock_response

    evaluate_rule(
        url="http://localhost:3000",
        api_key="test-key",
        entity_type="prompt",
        fields={"key": "val"},
        include_entity_data=True,
        entity_inputs={"variables": {"name": "test"}},
    )

    payload = mock_post.call_args[1]["json"]
    assert payload["include_entity_data"] is True
    assert payload["entity_inputs"] == {"variables": {"name": "test"}}
    assert payload["entity_type"] == "prompt"


@patch("openlit.requests.post")
def test_evaluate_rule_http_error_returns_none(mock_post):
    """Returns None on HTTP error."""
    from openlit import evaluate_rule
    import requests

    mock_post.side_effect = requests.RequestException("Connection refused")

    result = evaluate_rule(
        url="http://localhost:3000",
        api_key="test-key",
        entity_type="context",
        fields={},
    )

    assert result is None


@patch.dict("os.environ", {"OPENLIT_URL": "http://env-url:3000", "OPENLIT_API_KEY": "env-key"})
@patch("openlit.requests.post")
def test_evaluate_rule_uses_env_vars(mock_post):
    """Falls back to environment variables for url and api_key."""
    from openlit import evaluate_rule

    mock_response = MagicMock()
    mock_response.json.return_value = {"matchingRuleIds": []}
    mock_response.raise_for_status = MagicMock()
    mock_post.return_value = mock_response

    evaluate_rule(entity_type="context", fields={"key": "val"})

    call_url = mock_post.call_args[0][0]
    assert call_url == "http://env-url:3000/api/rule-engine/evaluate"
    assert mock_post.call_args[1]["headers"]["Authorization"] == "Bearer env-key"
