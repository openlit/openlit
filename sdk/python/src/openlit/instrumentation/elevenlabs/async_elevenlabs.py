"""
Module for monitoring ElevenLabs API calls.
"""

import time
from contextlib import aclosing
from opentelemetry.trace import SpanKind
from openlit.__helpers import handle_exception
from openlit.instrumentation.elevenlabs.utils import process_audio_response
from openlit.semcov import SemanticConvention


def async_generate(
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

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = "api.elevenlabs.io", 443
        request_model = kwargs.get(
            "model", kwargs.get("model_id", "eleven_multilingual_v2")
        )

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} {request_model}"

        # convert() is an async generator function: the HTTP request only runs
        # while the caller iterates, so the span has to stay open until the
        # iteration finishes, fails, or is closed early.
        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
        start_time = time.time()
        failed = False
        try:
            # aclosing() passes an early aclose() on to the wrapped stream,
            # as yield from does for the sync wrapper.
            async with aclosing(wrapped(*args, **kwargs)) as stream:
                async for chunk in stream:
                    yield chunk
        except Exception as e:
            failed = True
            handle_exception(span, e)
            raise
        finally:
            if not failed:
                try:
                    process_audio_response(
                        response=None,
                        gen_ai_endpoint=gen_ai_endpoint,
                        pricing_info=pricing_info,
                        server_port=server_port,
                        server_address=server_address,
                        environment=environment,
                        application_name=application_name,
                        metrics=metrics,
                        start_time=start_time,
                        span=span,
                        args=args,
                        kwargs=kwargs,
                        capture_message_content=capture_message_content,
                        disable_metrics=disable_metrics,
                        version=version,
                        event_provider=event_provider,
                    )
                except Exception as e:
                    handle_exception(span, e)
            span.end()

    return wrapper
