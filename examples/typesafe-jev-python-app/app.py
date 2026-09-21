"""One-shot TypeSafe Jev app instrumented with the OpenLIT Python SDK.

Sends one sync and one async System One request. Traces go to OpenLIT at
OTEL_EXPORTER_OTLP_ENDPOINT (default http://127.0.0.1:4318) via openlit.init().
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path


def _load_repo_env() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


_load_repo_env()

import openlit  # noqa: E402
from typesafe_sdk import AsyncTypeSafeClient, TypeSafeClient  # noqa: E402

SERVICE_NAME = os.environ.get("OPENLIT_SERVICE_NAME", "typesafe-jev-python")
ENVIRONMENT = os.environ.get("OPENLIT_ENVIRONMENT", "dev")
OTLP_ENDPOINT = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318")
MODEL = os.environ.get("JEV_MODEL", "jev-1.13.0")

QUESTIONS = {
    "hallucination": {
        "type": "noul",
        "instructions": "Flag invented or contradictory claims versus the ground-truth context.",
    }
}


def _noul(response) -> object:
    answers = getattr(response, "answers", None)
    if answers is None and isinstance(response, dict):
        answers = response.get("answers")
    if isinstance(answers, dict):
        answer = answers.get("hallucination")
        if isinstance(answer, dict):
            return answer.get("noul")
        return getattr(answer, "noul", None)
    return None


openlit.init(
    service_name=SERVICE_NAME,
    environment=ENVIRONMENT,
    otlp_endpoint=OTLP_ENDPOINT,
    disable_batch=True,
    capture_message_content=True,
)
print(
    f"[openlit] service={SERVICE_NAME} env={ENVIRONMENT} otlp={OTLP_ENDPOINT} model={MODEL}"
)


def run_sync() -> None:
    client = TypeSafeClient()
    response = client.system_one(
        state={
            "prompt": "What is 2+2?",
            "response": "5",
            "ground_truth_context": "2+2=4",
        },
        questions=QUESTIONS,
        model=MODEL,
    )
    print(f"[sync] model={getattr(response, 'model', None)} noul={_noul(response)}")


async def run_async() -> None:
    client = AsyncTypeSafeClient()
    try:
        response = await client.system_one(
            state={
                "prompt": "Name the capital of France.",
                "response": "Paris is in Germany.",
                "ground_truth_context": "The capital of France is Paris.",
            },
            questions=QUESTIONS,
            model=MODEL,
        )
        print(f"[async] model={getattr(response, 'model', None)} noul={_noul(response)}")
    finally:
        close = getattr(client, "aclose", None) or getattr(client, "close", None)
        if close is not None:
            result = close()
            if asyncio.iscoroutine(result):
                await result


if __name__ == "__main__":
    if not os.environ.get("TYPESAFE_API_KEY"):
        raise SystemExit("TYPESAFE_API_KEY is required")
    run_sync()
    asyncio.run(run_async())
    time.sleep(1)
    print("[openlit] sent decision spans")
