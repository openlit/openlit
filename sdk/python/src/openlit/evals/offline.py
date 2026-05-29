"""
Offline evaluation client for the OpenLIT server-side evaluation engine.

All evaluations run on the OpenLIT server (same engine as online/auto evals).
The SDK is a thin HTTP client that sends prompt/response pairs and receives
structured evaluation results.
"""

import logging
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import requests

from openlit._config import OpenlitConfig
from openlit.evals.offline_types import (
    BatchEvalResult,
    ContextInfo,
    EvalType,
    OfflineEvalResult,
    OfflineEvaluation,
)

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 120


def _resolve_api_key(explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit
    cfg_key = getattr(OpenlitConfig, "openlit_api_key", None)
    if cfg_key:
        return cfg_key
    env_key = os.getenv("OPENLIT_API_KEY")
    if env_key:
        return env_key
    raise ValueError(
        "Missing OpenLIT API key. Provide via openlit_api_key parameter, "
        "openlit.init(openlit_api_key=...), or set the OPENLIT_API_KEY env var."
    )


def _resolve_url(explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit.rstrip("/")
    cfg_url = getattr(OpenlitConfig, "openlit_url", None)
    if cfg_url:
        return cfg_url.rstrip("/")
    env_url = os.getenv("OPENLIT_URL")
    if env_url:
        return env_url.rstrip("/")
    raise ValueError(
        "Missing OpenLIT URL. Provide via openlit_url parameter, "
        "openlit.init(openlit_url=...), or set the OPENLIT_URL env var."
    )


def _resolve_attributes(
    explicit: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {}

    otel_res = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")
    if otel_res:
        for pair in otel_res.split(","):
            pair = pair.strip()
            if "=" in pair:
                k, v = pair.split("=", 1)
                attrs[k.strip()] = v.strip()

    otel_svc = os.getenv("OTEL_SERVICE_NAME")
    if otel_svc:
        attrs["service.name"] = otel_svc

    otel_env = os.getenv("OPENLIT_ENVIRONMENT") or os.getenv(
        "OTEL_DEPLOYMENT_ENVIRONMENT"
    )
    if otel_env:
        attrs["deployment.environment"] = otel_env

    cfg_app = getattr(OpenlitConfig, "application_name", "default")
    if cfg_app and cfg_app != "default":
        attrs["service.name"] = cfg_app

    cfg_env = getattr(OpenlitConfig, "environment", "default")
    if cfg_env and cfg_env != "default":
        attrs["deployment.environment"] = cfg_env

    if explicit:
        attrs.update(explicit)

    return {k: v for k, v in attrs.items() if v is not None and v != ""}


def _parse_eval_response(data: dict) -> OfflineEvalResult:
    evaluations = [
        OfflineEvaluation(
            type=e.get("type", ""),
            score=float(e.get("score", 0)),
            verdict=e.get("verdict", ""),
            classification=e.get("classification", ""),
            explanation=e.get("explanation", ""),
        )
        for e in data.get("evaluations", [])
    ]

    ctx = data.get("context_applied")
    context_info = None
    if ctx:
        context_info = ContextInfo(
            rule_matched=ctx.get("ruleMatched", False),
            matching_rule_ids=ctx.get("matchingRuleIds", []),
            context_entity_ids=ctx.get("contextEntityIds", []),
            user_contexts_count=ctx.get("userContextsCount", 0),
        )

    return OfflineEvalResult(
        success=data.get("success", False),
        evaluations=evaluations,
        context_applied=context_info,
        metadata=data.get("metadata"),
        error=data.get("err"),
    )


def run_eval(
    prompt: str,
    response: str,
    contexts: Optional[List[str]] = None,
    eval_types: Optional[List[str]] = None,
    attributes: Optional[Dict[str, Any]] = None,
    threshold_score: Optional[float] = None,
    store_results: Optional[bool] = None,
    run_id: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    openlit_api_key: Optional[str] = None,
    openlit_url: Optional[str] = None,
    print_results: bool = True,
) -> OfflineEvalResult:
    """
    Run a single offline evaluation against the OpenLIT server.

    Uses the same evaluation engine, rules, and contexts configured
    in the OpenLIT dashboard for online/auto evaluations.
    """
    api_key = _resolve_api_key(openlit_api_key)
    url = _resolve_url(openlit_url)
    merged_attributes = _resolve_attributes(attributes)

    payload: Dict[str, Any] = {
        "prompt": prompt,
        "response": response,
    }
    if contexts:
        payload["contexts"] = contexts
    if eval_types:
        payload["eval_types"] = eval_types
    if threshold_score is not None:
        payload["threshold_score"] = threshold_score
    if store_results is not None:
        payload["store_results"] = store_results
    if run_id:
        payload["run_id"] = run_id
    if metadata:
        payload["metadata"] = metadata
    if merged_attributes:
        payload["attributes"] = merged_attributes

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    endpoint = f"{url}/api/evaluation/offline"

    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            resp = requests.post(
                endpoint, json=payload, headers=headers, timeout=_HTTP_TIMEOUT
            )

            if resp.status_code == 401:
                return OfflineEvalResult(
                    success=False,
                    error="Authentication failed. Check your OpenLIT API key.",
                )

            if resp.status_code == 429 and attempt == 0:
                last_err = Exception("Rate limited (429)")
                continue

            if resp.status_code >= 500 and attempt == 0:
                last_err = Exception(f"Server error {resp.status_code}")
                continue

            try:
                data = resp.json()
            except ValueError:
                return OfflineEvalResult(
                    success=False,
                    error=f"Server returned non-JSON response (HTTP {resp.status_code})",
                )

            if not resp.ok:
                return OfflineEvalResult(
                    success=False,
                    error=data.get("err", f"HTTP {resp.status_code}"),
                )

            result = _parse_eval_response(data)

            if print_results:
                print(result.summary(), file=sys.stderr)

            return result

        except requests.exceptions.Timeout:
            return OfflineEvalResult(
                success=False,
                error=f"Request timed out after {_HTTP_TIMEOUT}s. "
                "The evaluation may still be running on the server.",
            )
        except requests.exceptions.ConnectionError as e:
            last_err = e
            if attempt == 0:
                continue
            return OfflineEvalResult(
                success=False,
                error=f"Cannot connect to OpenLIT server at {url}: {e}",
            )
        except Exception as e:
            logger.error("Unexpected error during evaluation: %s", e)
            return OfflineEvalResult(success=False, error=str(e))

    return OfflineEvalResult(
        success=False,
        error=f"Evaluation failed after retries: {last_err}",
    )


def run_eval_batch(
    dataset: List[Dict[str, Any]],
    eval_types: Optional[List[str]] = None,
    attributes: Optional[Dict[str, Any]] = None,
    threshold_score: Optional[float] = None,
    store_results: Optional[bool] = None,
    run_id: Optional[str] = None,
    max_concurrent: int = 5,
    openlit_api_key: Optional[str] = None,
    openlit_url: Optional[str] = None,
    print_results: bool = True,
) -> BatchEvalResult:
    """
    Run offline evaluations on a batch of prompt/response pairs.

    Each item in *dataset* must have at minimum ``prompt`` and ``response``
    keys. Optional per-item keys: ``contexts``, ``eval_types``, ``metadata``.
    """
    if not dataset:
        raise ValueError("dataset must be a non-empty list of prompt/response dicts")

    for i, item in enumerate(dataset):
        if not isinstance(item, dict):
            raise TypeError(f"dataset[{i}] must be a dict, got {type(item).__name__}")
        if "prompt" not in item or not isinstance(item["prompt"], str):
            raise ValueError(f"dataset[{i}] must have a 'prompt' string key")
        if "response" not in item or not isinstance(item["response"], str):
            raise ValueError(f"dataset[{i}] must have a 'response' string key")

    if not run_id:
        run_id = f"batch_{uuid.uuid4().hex[:12]}"

    results: List[Optional[OfflineEvalResult]] = [None] * len(dataset)

    def _run_single(idx: int, item: Dict[str, Any]) -> tuple:
        r = run_eval(
            prompt=item["prompt"],
            response=item["response"],
            contexts=item.get("contexts"),
            eval_types=item.get("eval_types", eval_types),
            attributes=item.get("attributes", attributes),
            threshold_score=item.get("threshold_score", threshold_score),
            store_results=store_results,
            run_id=run_id,
            metadata=item.get("metadata"),
            openlit_api_key=openlit_api_key,
            openlit_url=openlit_url,
            print_results=False,
        )
        return idx, r

    with ThreadPoolExecutor(max_workers=max_concurrent) as pool:
        futures = {
            pool.submit(_run_single, i, item): i for i, item in enumerate(dataset)
        }
        for future in as_completed(futures):
            try:
                idx, result = future.result()
                results[idx] = result
            except Exception as e:
                idx = futures[future]
                results[idx] = OfflineEvalResult(success=False, error=str(e))

    batch = BatchEvalResult(
        results=[r for r in results if r is not None],
        run_id=run_id,
    )

    if print_results:
        print(batch.aggregate_summary(), file=sys.stderr)

    return batch


def fetch_eval_types(
    openlit_api_key: Optional[str] = None,
    openlit_url: Optional[str] = None,
) -> List[EvalType]:
    """
    Fetch available evaluation types from the OpenLIT server.

    Returns both built-in and custom evaluation types configured
    in the OpenLIT dashboard.
    """
    api_key = _resolve_api_key(openlit_api_key)
    url = _resolve_url(openlit_url)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    endpoint = f"{url}/api/evaluation/offline/types"

    try:
        resp = requests.get(endpoint, headers=headers, timeout=_HTTP_TIMEOUT)

        if resp.status_code == 401:
            raise ValueError("Authentication failed. Check your OpenLIT API key.")

        resp.raise_for_status()
        data = resp.json()
        return [
            EvalType(
                id=t.get("id", ""),
                label=t.get("label", ""),
                description=t.get("description", ""),
                enabled=t.get("enabled", False),
                is_custom=t.get("is_custom", False),
            )
            for t in data.get("eval_types", [])
        ]
    except requests.exceptions.ConnectionError as exc:
        raise ConnectionError(
            f"Cannot connect to OpenLIT server at {url}: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise TimeoutError(
            f"Request to OpenLIT server timed out after {_HTTP_TIMEOUT}s"
        ) from exc
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to fetch eval types: {exc}") from exc
