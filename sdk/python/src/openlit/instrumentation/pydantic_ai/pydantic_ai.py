"""
Module for monitoring Pydantic AI API calls.
"""

from openlit.instrumentation.pydantic_ai.utils import (
    common_agent_run,
    common_agent_create
)

def agent_create(version, environment, application_name,
    tracer, pricing_info, capture_message_content, metrics, disable_metrics):

    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        response = wrapped(*args, **kwargs)
        return common_agent_create(wrapped, instance, args, kwargs, tracer,
                                 version, environment, application_name,
                                 capture_message_content, response=response)

    return wrapper

def agent_run(version, environment, application_name,
              tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        response = wrapped(*args, **kwargs)
        return common_agent_run(wrapped, instance, args, kwargs, tracer,
                                    version, environment, application_name,
                                    capture_message_content, response=response)

    return wrapper

def async_agent_run(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    async def wrapper(wrapped, instance, args, kwargs):
        response = await wrapped(*args, **kwargs)
        return common_agent_run(wrapped, instance, args, kwargs, tracer,
                                          version, environment, application_name,
                                          capture_message_content, response=response)

    return wrapper
