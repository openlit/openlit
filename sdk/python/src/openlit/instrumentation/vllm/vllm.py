# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring vLLM API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import handle_exception, general_tokens
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for generate to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the vLLM API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of vLLM usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the generate method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate' method.
            kwargs: Keyword arguments for the 'generate' method.

        Returns:
            The response from the original 'generate' method.
        """

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                model = instance.llm_engine.model_config.model or "facebook/opt-125m"
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_VLLM)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                input_tokens = 0
                output_tokens = 0
                cost = 0

                if trace_content:
                    prompt_attributes = {}
                    completion_attributes = {}

                    for i, output in enumerate(response):
                        prompt_attributes[f"{SemanticConvetion.GEN_AI_CONTENT_PROMPT}.{i}"] = output.prompt
                        completion_attributes[f"{SemanticConvetion.GEN_AI_CONTENT_COMPLETION}.{i}"] = output.outputs[0].text
                        input_tokens += general_tokens(output.prompt)
                        output_tokens += general_tokens(output.outputs[0].text)

                    # Add a single event for all prompts
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes=prompt_attributes,
                    )

                    # Add a single event for all completions
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes=completion_attributes,
                    )

                total_tokens = input_tokens + output_tokens

                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    total_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_VLLM,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(total_tokens, attributes)
                    metrics["genai_completion_tokens"].add(output_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
