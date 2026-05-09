"""Tests for openlit offline evaluation (openlit.eval / openlit.evals.offline)."""

import os
from unittest.mock import patch, MagicMock

import pytest
import requests


def test_eval_is_importable():
    """openlit.eval is importable and callable."""
    from openlit import eval as openlit_eval  # pylint: disable=redefined-builtin

    assert callable(openlit_eval)


def test_eval_batch_is_importable():
    """openlit.eval_batch is importable and callable."""
    from openlit import eval_batch

    assert callable(eval_batch)


def test_get_eval_types_is_importable():
    """openlit.get_eval_types is importable and callable."""
    from openlit import get_eval_types

    assert callable(get_eval_types)


def test_offline_types_importable():
    """Pydantic models are importable from openlit.evals."""
    from openlit.evals import (
        OfflineEvaluation,
        OfflineEvalResult,
        BatchEvalResult,
        EvalType,
        ContextInfo,
    )

    assert OfflineEvaluation is not None
    assert OfflineEvalResult is not None
    assert BatchEvalResult is not None
    assert EvalType is not None
    assert ContextInfo is not None


# --- resolve helpers ---


def test_resolve_api_key_explicit():
    """Explicit API key is returned as-is."""
    from openlit.evals.offline import _resolve_api_key

    assert _resolve_api_key("my-key") == "my-key"


def test_resolve_api_key_from_env():
    """API key falls back to OPENLIT_API_KEY env var."""
    from openlit.evals.offline import _resolve_api_key

    with patch.dict(os.environ, {"OPENLIT_API_KEY": "env-key"}):
        assert _resolve_api_key(None) == "env-key"


def test_resolve_api_key_missing():
    """Missing API key raises ValueError."""
    from openlit.evals.offline import _resolve_api_key
    from openlit._config import OpenlitConfig

    with patch.dict(os.environ, {}, clear=True):
        OpenlitConfig.openlit_api_key = None
        env_cleared = {k: v for k, v in os.environ.items() if k != "OPENLIT_API_KEY"}
        with patch.dict(os.environ, env_cleared, clear=True):
            with pytest.raises(ValueError, match="Missing OpenLIT API key"):
                _resolve_api_key(None)


def test_resolve_url_explicit():
    """Explicit URL with trailing slash is stripped."""
    from openlit.evals.offline import _resolve_url

    assert _resolve_url("http://localhost:3000/") == "http://localhost:3000"


def test_resolve_url_from_env():
    """URL falls back to OPENLIT_URL env var."""
    from openlit.evals.offline import _resolve_url

    with patch.dict(os.environ, {"OPENLIT_URL": "http://env-url:3000"}):
        assert _resolve_url(None) == "http://env-url:3000"


def test_resolve_attributes_otel_env():
    """Attributes are resolved from OTEL env vars."""
    from openlit.evals.offline import _resolve_attributes

    with patch.dict(
        os.environ,
        {
            "OTEL_RESOURCE_ATTRIBUTES": "service.version=1.0,team=ml",
            "OTEL_SERVICE_NAME": "my-service",
        },
    ):
        attrs = _resolve_attributes(None)
        assert attrs["service.name"] == "my-service"
        assert attrs["service.version"] == "1.0"
        assert attrs["team"] == "ml"


def test_resolve_attributes_explicit_overrides():
    """Explicit attributes override env vars."""
    from openlit.evals.offline import _resolve_attributes

    with patch.dict(os.environ, {"OTEL_SERVICE_NAME": "env-service"}):
        attrs = _resolve_attributes({"service.name": "explicit-svc"})
        assert attrs["service.name"] == "explicit-svc"


def test_resolve_attributes_config_overrides_otel():
    """OpenlitConfig values override OTEL env vars."""
    from openlit.evals.offline import _resolve_attributes
    from openlit._config import OpenlitConfig

    original_app = getattr(OpenlitConfig, "application_name", "default")
    original_env = getattr(OpenlitConfig, "environment", "default")
    try:
        OpenlitConfig.application_name = "config-app"
        OpenlitConfig.environment = "staging"
        with patch.dict(os.environ, {"OTEL_SERVICE_NAME": "otel-svc"}):
            attrs = _resolve_attributes(None)
            assert attrs["service.name"] == "config-app"
            assert attrs["deployment.environment"] == "staging"
    finally:
        OpenlitConfig.application_name = original_app
        OpenlitConfig.environment = original_env


# --- run_eval ---


@patch("openlit.evals.offline.requests.post")
def test_run_eval_success(mock_post):
    """Successful eval returns parsed result with evaluations."""
    from openlit.evals.offline import run_eval

    mock_response = MagicMock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "evaluations": [
            {
                "type": "hallucination",
                "score": 0.1,
                "verdict": "no",
                "classification": "none",
                "explanation": "No hallucination detected.",
            }
        ],
        "context_applied": {
            "ruleMatched": False,
            "matchingRuleIds": [],
            "contextEntityIds": [],
            "userContextsCount": 0,
        },
        "metadata": {"model": "openai/gpt-4o", "evalTypesRun": ["hallucination"]},
    }
    mock_post.return_value = mock_response

    result = run_eval(
        prompt="What is the capital of France?",
        response="The capital of France is Paris.",
        openlit_api_key="test-key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert result.success is True
    assert len(result.evaluations) == 1
    assert result.evaluations[0].type == "hallucination"
    assert result.evaluations[0].score == 0.1
    assert result.passed is True

    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args
    assert call_kwargs[1]["headers"]["Authorization"] == "Bearer test-key"


@patch("openlit.evals.offline.requests.post")
def test_run_eval_auth_failure(mock_post):
    """401 response returns authentication failure error."""
    from openlit.evals.offline import run_eval

    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_post.return_value = mock_response

    result = run_eval(
        prompt="test",
        response="test",
        openlit_api_key="bad-key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert result.success is False
    assert result.error is not None
    assert "Authentication failed" in str(result.error)


@patch("openlit.evals.offline.requests.post")
def test_run_eval_failed_verdict(mock_post):
    """Evaluation with 'yes' verdict is marked as failed."""
    from openlit.evals.offline import run_eval

    mock_response = MagicMock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "evaluations": [
            {
                "type": "toxicity",
                "score": 0.9,
                "verdict": "yes",
                "classification": "hate_speech",
                "explanation": "Contains toxic language.",
            }
        ],
        "metadata": {},
    }
    mock_post.return_value = mock_response

    result = run_eval(
        prompt="test",
        response="bad response",
        openlit_api_key="test-key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert result.success is True
    assert result.passed is False
    assert len(result.failed_evals) == 1
    assert result.failed_evals[0].type == "toxicity"


# --- run_eval_batch ---


@patch("openlit.evals.offline.requests.post")
def test_run_eval_batch(mock_post):
    """Batch evaluation processes all items and returns aggregate results."""
    from openlit.evals.offline import run_eval_batch

    mock_response = MagicMock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "evaluations": [
            {
                "type": "hallucination",
                "score": 0.1,
                "verdict": "no",
                "classification": "none",
                "explanation": "OK",
            }
        ],
        "metadata": {},
    }
    mock_post.return_value = mock_response

    dataset = [
        {"prompt": "Q1", "response": "A1"},
        {"prompt": "Q2", "response": "A2"},
    ]

    result = run_eval_batch(
        dataset=dataset,
        openlit_api_key="test-key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert len(result.results) == 2
    assert result.all_passed is True
    assert result.pass_rate == 1.0
    assert result.run_id is not None


# --- fetch_eval_types ---


@patch("openlit.evals.offline.requests.get")
def test_fetch_eval_types(mock_get):
    """Fetch eval types returns parsed EvalType list."""
    from openlit.evals.offline import fetch_eval_types

    mock_response = MagicMock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "eval_types": [
            {
                "id": "hallucination",
                "label": "Hallucination",
                "description": "Detects hallucinated content",
                "enabled": True,
                "is_custom": False,
            },
            {
                "id": "custom_safety",
                "label": "Custom Safety",
                "description": "Custom safety check",
                "enabled": True,
                "is_custom": True,
            },
        ]
    }
    mock_response.raise_for_status = MagicMock()
    mock_get.return_value = mock_response

    types = fetch_eval_types(
        openlit_api_key="test-key",
        openlit_url="http://localhost:3000",
    )

    assert len(types) == 2
    assert types[0].id == "hallucination"
    assert types[0].is_custom is False
    assert types[1].id == "custom_safety"
    assert types[1].is_custom is True


# --- Terminal output ---


def test_summary_output():
    """Summary of a passing result contains PASSED and eval type."""
    from openlit.evals.offline_types import OfflineEvalResult, OfflineEvaluation

    result = OfflineEvalResult(
        success=True,
        evaluations=[
            OfflineEvaluation(
                type="hallucination",
                score=0.1,
                verdict="no",
                classification="none",
                explanation="OK",
            )
        ],
    )
    summary = result.summary()
    assert "PASSED" in summary
    assert "hallucination" in summary


def test_summary_failed():
    """Summary of a failing result contains FAILED."""
    from openlit.evals.offline_types import OfflineEvalResult, OfflineEvaluation

    result = OfflineEvalResult(
        success=True,
        evaluations=[
            OfflineEvaluation(
                type="toxicity",
                score=0.9,
                verdict="yes",
                classification="hate_speech",
                explanation="Bad",
            )
        ],
    )
    summary = result.summary()
    assert "FAILED" in summary


def test_summary_error():
    """Summary of an error result contains the error message."""
    from openlit.evals.offline_types import OfflineEvalResult

    result = OfflineEvalResult(success=False, error="something broke")
    summary = result.summary()
    assert "something broke" in summary


def test_batch_aggregate_summary():
    """Batch aggregate summary shows pass/fail counts and run ID."""
    from openlit.evals.offline_types import (
        BatchEvalResult,
        OfflineEvalResult,
        OfflineEvaluation,
    )

    batch = BatchEvalResult(
        results=[
            OfflineEvalResult(
                success=True,
                evaluations=[
                    OfflineEvaluation(type="hallucination", score=0.1, verdict="no")
                ],
            ),
            OfflineEvalResult(
                success=True,
                evaluations=[
                    OfflineEvaluation(type="toxicity", score=0.9, verdict="yes")
                ],
            ),
        ],
        run_id="test-run",
    )
    summary = batch.aggregate_summary()
    assert "1 FAILED" in summary
    assert "test-run" in summary
    assert batch.pass_rate == 0.5


# --- Edge cases ---


def test_empty_batch_all_passed_is_false():
    """Empty batch returns all_passed=False and pass_rate=0.0."""
    from openlit.evals.offline_types import BatchEvalResult

    batch = BatchEvalResult(results=[], run_id="empty")
    assert batch.all_passed is False
    assert batch.pass_rate == 0.0


def test_batch_validates_empty_dataset():
    """Empty dataset raises ValueError."""
    from openlit.evals.offline import run_eval_batch

    with pytest.raises(ValueError, match="non-empty"):
        run_eval_batch(
            dataset=[],
            openlit_api_key="key",
            openlit_url="http://localhost:3000",
        )


def test_batch_validates_missing_prompt():
    """Dataset item missing 'prompt' raises ValueError."""
    from openlit.evals.offline import run_eval_batch

    with pytest.raises(ValueError, match="dataset\\[0\\].*prompt"):
        run_eval_batch(
            dataset=[{"response": "answer"}],
            openlit_api_key="key",
            openlit_url="http://localhost:3000",
        )


def test_batch_validates_missing_response():
    """Dataset item missing 'response' raises ValueError."""
    from openlit.evals.offline import run_eval_batch

    with pytest.raises(ValueError, match="dataset\\[0\\].*response"):
        run_eval_batch(
            dataset=[{"prompt": "question"}],
            openlit_api_key="key",
            openlit_url="http://localhost:3000",
        )


@patch("openlit.evals.offline.requests.post")
def test_run_eval_non_json_error(mock_post):
    """Non-JSON error response is handled gracefully."""
    from openlit.evals.offline import run_eval

    mock_response = MagicMock()
    mock_response.status_code = 502
    mock_response.ok = False
    mock_response.json.side_effect = ValueError("No JSON")
    mock_post.return_value = mock_response

    result = run_eval(
        prompt="test",
        response="test",
        openlit_api_key="key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert result.success is False
    assert result.error is not None
    assert "non-JSON" in str(result.error)


@patch("openlit.evals.offline.requests.post")
def test_run_eval_429_retries(mock_post):
    """429 response triggers a retry and succeeds on second attempt."""
    from openlit.evals.offline import run_eval

    rate_limit_resp = MagicMock()
    rate_limit_resp.status_code = 429
    rate_limit_resp.ok = False

    success_resp = MagicMock()
    success_resp.status_code = 200
    success_resp.ok = True
    success_resp.json.return_value = {
        "success": True,
        "evaluations": [
            {
                "type": "hallucination",
                "score": 0.1,
                "verdict": "no",
                "classification": "none",
                "explanation": "OK",
            }
        ],
        "metadata": {},
    }

    mock_post.side_effect = [rate_limit_resp, success_resp]

    result = run_eval(
        prompt="test",
        response="test",
        openlit_api_key="key",
        openlit_url="http://localhost:3000",
        print_results=False,
    )

    assert result.success is True
    assert mock_post.call_count == 2


def test_fetch_eval_types_auth_failure():
    """401 on fetch_eval_types raises ValueError."""
    from openlit.evals.offline import fetch_eval_types

    with patch("openlit.evals.offline.requests.get") as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_get.return_value = mock_response

        with pytest.raises(ValueError, match="Authentication failed"):
            fetch_eval_types(
                openlit_api_key="bad-key",
                openlit_url="http://localhost:3000",
            )


def test_fetch_eval_types_connection_error():
    """Connection error on fetch_eval_types raises ConnectionError."""
    from openlit.evals.offline import fetch_eval_types

    with patch("openlit.evals.offline.requests.get") as mock_get:
        mock_get.side_effect = requests.exceptions.ConnectionError("refused")

        with pytest.raises(ConnectionError, match="Cannot connect"):
            fetch_eval_types(
                openlit_api_key="key",
                openlit_url="http://localhost:3000",
            )
