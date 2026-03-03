"""
OpenLIT Agent SRE Instrumentation

Auto-instruments agent-sre (https://github.com/imran-siddique/agent-sre)
to capture SLO evaluations, chaos experiments, error budget events,
and resilience scores as OpenTelemetry spans and metrics.
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.agent_sre.agent_sre import (
    wrap_slo_evaluate,
    wrap_chaos_start,
    wrap_chaos_complete,
    wrap_error_budget_record,
    wrap_sli_record,
)

_instruments = ("agent-sre >= 1.0.0",)

# SLO/SLI operations
SLO_OPERATIONS = [
    ("agent_sre.slo.objectives", "SLO.evaluate", "slo_evaluate"),
    ("agent_sre.slo.objectives", "ErrorBudget.record_event", "error_budget_record"),
]

# Chaos operations
CHAOS_OPERATIONS = [
    ("agent_sre.chaos.engine", "ChaosExperiment.start", "chaos_start"),
    ("agent_sre.chaos.engine", "ChaosExperiment.complete", "chaos_complete"),
    ("agent_sre.chaos.engine", "ChaosExperiment.abort", "chaos_abort"),
]

# SLI recording (detailed tracing)
SLI_OPERATIONS = [
    ("agent_sre.slo.indicators", "TaskSuccessRate.record", "sli_task_success"),
    ("agent_sre.slo.indicators", "ResponseLatency.record", "sli_response_latency"),
    ("agent_sre.slo.indicators", "ToolCallAccuracy.record", "sli_tool_accuracy"),
    ("agent_sre.slo.indicators", "PolicyCompliance.record", "sli_policy_compliance"),
    ("agent_sre.slo.indicators", "HallucinationRate.record", "sli_hallucination"),
]

# Map of wrapper functions by operation type
WRAPPER_MAP = {
    "slo_evaluate": wrap_slo_evaluate,
    "error_budget_record": wrap_error_budget_record,
    "chaos_start": wrap_chaos_start,
    "chaos_complete": wrap_chaos_complete,
    "chaos_abort": wrap_chaos_complete,  # Same pattern as complete
    "sli_task_success": wrap_sli_record,
    "sli_response_latency": wrap_sli_record,
    "sli_tool_accuracy": wrap_sli_record,
    "sli_policy_compliance": wrap_sli_record,
    "sli_hallucination": wrap_sli_record,
}


class AgentSREInstrumentor(BaseInstrumentor):
    """
    Instrumentor for Agent SRE — AI-native SRE framework.

    Captures SLO evaluations, chaos experiments, error budget consumption,
    and SLI measurements as OpenTelemetry spans and metrics visible in
    OpenLit's dashboard.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("agent-sre")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        common_args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

        # SLO operations (always enabled)
        for module, method, op_type in SLO_OPERATIONS:
            try:
                wrapper_fn = WRAPPER_MAP[op_type]
                wrap_function_wrapper(
                    module, method, wrapper_fn(op_type, *common_args),
                )
            except Exception:
                pass

        # Chaos operations (always enabled)
        for module, method, op_type in CHAOS_OPERATIONS:
            try:
                wrapper_fn = WRAPPER_MAP[op_type]
                wrap_function_wrapper(
                    module, method, wrapper_fn(op_type, *common_args),
                )
            except Exception:
                pass

        # SLI operations (detailed tracing only)
        if detailed_tracing:
            for module, method, op_type in SLI_OPERATIONS:
                try:
                    wrapper_fn = WRAPPER_MAP[op_type]
                    wrap_function_wrapper(
                        module, method, wrapper_fn(op_type, *common_args),
                    )
                except Exception:
                    pass

    def _uninstrument(self, **kwargs):
        """Uninstrument Agent SRE operations."""
