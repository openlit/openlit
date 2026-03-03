"""
Utility functions for Agent SRE instrumentation.

Sets span attributes and records metrics for SLO, chaos, error budget,
and SLI operations following OpenTelemetry semantic conventions.
"""

from opentelemetry.trace import StatusCode


# Semantic conventions for Agent SRE spans
AGENT_SRE_SYSTEM = "agent_sre"
ATTR_SRE_VERSION = "agent.sre.version"
ATTR_ENVIRONMENT = "deployment.environment"
ATTR_APPLICATION = "application.name"

# SLO attributes
ATTR_SLO_NAME = "agent.sre.slo.name"
ATTR_SLO_STATUS = "agent.sre.slo.status"
ATTR_SLO_DESCRIPTION = "agent.sre.slo.description"
ATTR_ERROR_BUDGET_TOTAL = "agent.sre.error_budget.total"
ATTR_ERROR_BUDGET_CONSUMED = "agent.sre.error_budget.consumed"
ATTR_ERROR_BUDGET_REMAINING = "agent.sre.error_budget.remaining_percent"
ATTR_BURN_RATE = "agent.sre.burn_rate"
ATTR_IS_EXHAUSTED = "agent.sre.error_budget.is_exhausted"

# Chaos attributes
ATTR_CHAOS_ID = "agent.sre.chaos.experiment_id"
ATTR_CHAOS_NAME = "agent.sre.chaos.experiment_name"
ATTR_CHAOS_TARGET = "agent.sre.chaos.target_agent"
ATTR_CHAOS_STATE = "agent.sre.chaos.state"
ATTR_CHAOS_DURATION = "agent.sre.chaos.duration_seconds"
ATTR_CHAOS_BLAST_RADIUS = "agent.sre.chaos.blast_radius"
ATTR_CHAOS_FAULT_COUNT = "agent.sre.chaos.fault_count"
ATTR_CHAOS_INJECTION_COUNT = "agent.sre.chaos.injection_count"
ATTR_CHAOS_RESILIENCE_SCORE = "agent.sre.chaos.resilience_score"
ATTR_CHAOS_RESILIENCE_PASSED = "agent.sre.chaos.resilience_passed"
ATTR_CHAOS_ABORT_REASON = "agent.sre.chaos.abort_reason"

# SLI attributes
ATTR_SLI_NAME = "agent.sre.sli.name"
ATTR_SLI_VALUE = "agent.sre.sli.value"
ATTR_SLI_TARGET = "agent.sre.sli.target"
ATTR_SLI_WINDOW = "agent.sre.sli.window"

# Error budget event attributes
ATTR_BUDGET_EVENT_GOOD = "agent.sre.error_budget.event_good"


def _set_common_attributes(span, version, environment, application_name):
    """Set common attributes on all Agent SRE spans."""
    span.set_attribute(ATTR_SRE_VERSION, version)
    span.set_attribute(ATTR_ENVIRONMENT, environment)
    span.set_attribute(ATTR_APPLICATION, application_name)
    span.set_attribute("gen_ai.system", AGENT_SRE_SYSTEM)


def set_slo_span_attributes(span, slo, status, version, environment, application_name):
    """Set attributes for SLO evaluation spans."""
    _set_common_attributes(span, version, environment, application_name)

    span.set_attribute(ATTR_SLO_NAME, getattr(slo, "name", "unknown"))
    span.set_attribute(ATTR_SLO_STATUS, status.value if hasattr(status, "value") else str(status))
    span.set_attribute(ATTR_SLO_DESCRIPTION, getattr(slo, "description", ""))

    budget = getattr(slo, "error_budget", None)
    if budget:
        span.set_attribute(ATTR_ERROR_BUDGET_TOTAL, budget.total)
        span.set_attribute(ATTR_ERROR_BUDGET_CONSUMED, budget.consumed)
        span.set_attribute(ATTR_ERROR_BUDGET_REMAINING, budget.remaining_percent)
        span.set_attribute(ATTR_BURN_RATE, budget.burn_rate())
        span.set_attribute(ATTR_IS_EXHAUSTED, budget.is_exhausted)

    # Set span status based on SLO status
    status_val = status.value if hasattr(status, "value") else str(status)
    if status_val in ("exhausted", "critical"):
        span.set_status(StatusCode.ERROR, f"SLO {slo.name} is {status_val}")
    else:
        span.set_status(StatusCode.OK)


def set_chaos_span_attributes(span, experiment, action, version, environment, application_name):
    """Set attributes for chaos experiment spans."""
    _set_common_attributes(span, version, environment, application_name)

    span.set_attribute(ATTR_CHAOS_ID, getattr(experiment, "experiment_id", ""))
    span.set_attribute(ATTR_CHAOS_NAME, getattr(experiment, "name", "unknown"))
    span.set_attribute(ATTR_CHAOS_TARGET, getattr(experiment, "target_agent", ""))
    span.set_attribute(ATTR_CHAOS_STATE, getattr(experiment, "state", None) and experiment.state.value or "unknown")
    span.set_attribute(ATTR_CHAOS_DURATION, getattr(experiment, "duration_seconds", 0))
    span.set_attribute(ATTR_CHAOS_BLAST_RADIUS, getattr(experiment, "blast_radius", 1.0))

    faults = getattr(experiment, "faults", [])
    span.set_attribute(ATTR_CHAOS_FAULT_COUNT, len(faults))

    events = getattr(experiment, "injection_events", [])
    span.set_attribute(ATTR_CHAOS_INJECTION_COUNT, len(events))

    resilience = getattr(experiment, "resilience", None)
    if resilience:
        span.set_attribute(ATTR_CHAOS_RESILIENCE_SCORE, resilience.overall)
        span.set_attribute(ATTR_CHAOS_RESILIENCE_PASSED, resilience.passed)

    abort_reason = getattr(experiment, "abort_reason", None)
    if abort_reason:
        span.set_attribute(ATTR_CHAOS_ABORT_REASON, abort_reason)
        span.set_status(StatusCode.ERROR, abort_reason)
    elif action == "complete":
        span.set_status(StatusCode.OK)

    # Add fault types as events
    for fault in faults:
        span.add_event(
            "fault_definition",
            attributes={
                "fault_type": fault.fault_type.value,
                "target": fault.target,
                "rate": fault.rate,
            },
        )


def set_error_budget_span_attributes(span, budget, good, version, environment, application_name):
    """Set attributes for error budget record_event spans."""
    _set_common_attributes(span, version, environment, application_name)

    span.set_attribute(ATTR_BUDGET_EVENT_GOOD, good)
    span.set_attribute(ATTR_ERROR_BUDGET_TOTAL, budget.total)
    span.set_attribute(ATTR_ERROR_BUDGET_CONSUMED, budget.consumed)
    span.set_attribute(ATTR_ERROR_BUDGET_REMAINING, budget.remaining_percent)
    span.set_attribute(ATTR_IS_EXHAUSTED, budget.is_exhausted)

    if budget.is_exhausted:
        span.set_status(StatusCode.ERROR, "Error budget exhausted")
    elif not good:
        span.set_status(StatusCode.OK, "Bad event recorded against budget")
    else:
        span.set_status(StatusCode.OK)


def set_sli_span_attributes(span, sli, args, version, environment, application_name):
    """Set attributes for SLI record spans."""
    _set_common_attributes(span, version, environment, application_name)

    span.set_attribute(ATTR_SLI_NAME, getattr(sli, "name", "unknown"))
    span.set_attribute(ATTR_SLI_TARGET, getattr(sli, "target", 0.0))

    window = getattr(sli, "window", None)
    if window and hasattr(window, "value"):
        span.set_attribute(ATTR_SLI_WINDOW, window.value)

    current = sli.current_value() if hasattr(sli, "current_value") else None
    if current is not None:
        span.set_attribute(ATTR_SLI_VALUE, current)

    span.set_status(StatusCode.OK)


def record_sre_metrics(metrics, operation, instance, response, duration):
    """Record Agent SRE metrics to OpenLit's metric instruments.

    Args:
        metrics: OpenLit metrics dictionary
        operation: Operation type string
        instance: The agent-sre object (SLO, ChaosExperiment, etc.)
        response: Operation response/result
        duration: Operation duration in seconds
    """
    if not metrics:
        return

    try:
        counter = metrics.get("gen_ai_client_operation_duration")
        if counter and duration > 0:
            counter.record(
                duration,
                attributes={
                    "gen_ai.system": AGENT_SRE_SYSTEM,
                    "gen_ai.operation.name": operation,
                },
            )
    except Exception:
        pass
