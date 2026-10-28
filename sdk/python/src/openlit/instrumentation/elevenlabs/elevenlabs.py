"""
Module for monitoring ElevenLabs API calls.
"""

from openlit.instrumentation.elevenlabs.utils import trace_audio_request


def generate(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        # convert() is a generator function: the HTTP request only runs
        # while the caller iterates, so the span has to stay open until the
        # iteration finishes, fails, or is closed early.
        with trace_audio_request(
            tracer,
            gen_ai_endpoint,
            version,
            environment,
            application_name,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
            event_provider,
            args,
            kwargs,
        ):
            yield from wrapped(*args, **kwargs)

    return wrapper
