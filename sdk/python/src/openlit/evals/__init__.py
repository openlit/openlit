"""
openlit.evals

Server-side evaluation capabilities for AI-generated text.
Uses the OpenLIT evaluation engine for hallucination, bias, toxicity,
and custom evaluation types.
"""

from openlit.evals.offline import run_eval, run_eval_batch, fetch_eval_types
from openlit.evals.offline_types import (
    OfflineEvaluation,
    OfflineEvalResult,
    BatchEvalResult,
    EvalType,
    ContextInfo,
)
