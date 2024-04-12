# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Pinecone.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from ..__helpers import handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def object_count(obj):
    """
    Counts Length of object if it exists, Else returns None
    """

    if obj:
        return len(obj)

    return None

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content):
    """
    Wraps a Pinecone operation to trace and log its execution metrics.

    This function is intended to wrap around Pinecone operations in order to
    measure their execution time, log relevant information, and trace the execution
    using OpenTelemetry. This helps in monitoring and debugging operations within
    the Pinecone space.

    Parameters:
    - pinecone_operation (str): The specific Pinecone operation being monitored.
                                Examples include 'create_index', 'query', 'upsert', etc.
    - version (str): The version of the application interfacing with Pinecone.
    - environment (str): The deployment environment, such as 'production' or 'development'.
    - application_name (str): The name of the application performing the Pinecone operation.
    - tracer (opentelemetry.trace.Tracer): An object used for OpenTelemetry tracing.
    - pricing_info (dict): Information about pricing, not used in current implementation.
    - trace_content (bool): A flag indicating whether the content of responses should be traced.

    Returns:
    - function: A decorator function that, when applied, wraps the target function with
                additional functionality for tracing and logging Pinecone operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Executes the wrapped Pinecone operation, adding tracing and logging.

        This inner wrapper function captures the execution of Pinecone operations,
        annotating the operation with relevant metrics and tracing information, and
        ensuring any exceptions are caught and logged appropriately.

        Parameters:
        - wrapped (Callable): The Pinecone operation to be wrapped and executed.
        - instance (object): The instance on which the operation is called (for class methods).
        - args (tuple): Positional arguments for the Pinecone operation.
        - kwargs (dict): Keyword arguments for the Pinecone operation.

        Returns:
        - Any: The result of executing the wrapped Pinecone operation.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                span.set_attribute("gen_ai.environment", environment)
                span.set_attribute("gen_ai.application_name", application_name)
                span.set_attribute("gen_ai.type", "vectordb")
                span.set_attribute("db.system", "pinecone")

                if gen_ai_endpoint == "pinecone.create_index":
                    span.set_attribute("db.operation", "create_index")
                    span.set_attribute("db.create_index.name", kwargs.get("name", ""))
                    span.set_attribute("db.create_index.dimensions", kwargs.get("dimensions", ""))
                    span.set_attribute("db.create_index.metric", kwargs.get("metric", ""))
                    span.set_attribute("db.create_index.spec", str(kwargs.get("spec", "")))

                elif gen_ai_endpoint == "pinecone.query":
                    span.set_attribute("db.operation", "query")
                    span.set_attribute("db.query.statement", str(kwargs.get("vector")))
                    span.set_attribute("db.query.n_results", kwargs.get("top_k", ""))
                    span.set_attribute("db.query.filter", str(kwargs.get("filter", "")))
                    span.set_attribute("db.query.namespace", str(kwargs.get("namespace", "")))

                elif gen_ai_endpoint == "pinecone.update":
                    span.set_attribute("db.operation", "update")
                    span.set_attribute("db.update.id", kwargs.get("id",""))
                    span.set_attribute("db.update.values", str(kwargs.get("values",[])))
                    span.set_attribute("db.update.namespace", str(kwargs.get("namespace", "")))
                    span.set_attribute("db.update.metadata", str(kwargs.get("set_metadata", "")))

                elif gen_ai_endpoint == "pinecone.upsert":
                    span.set_attribute("db.operation", "upsert")
                    span.set_attribute("db.upsert.vector_count",
                                       object_count(kwargs.get("vectors")))

                elif gen_ai_endpoint == "pinecone.delete":
                    span.set_attribute("db.operation", "delete")
                    span.set_attribute("db.delete.ids_count", object_count(kwargs.get("ids")))
                    span.set_attribute("db.delete.filter", str(kwargs.get("filter", "")))
                    span.set_attribute("db.delete.delete_all", kwargs.get("delete_all", False))
                    span.set_attribute("db.delete.namespace", kwargs.get("namespace", ""))

                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
