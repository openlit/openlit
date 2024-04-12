# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring ChromaDB.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from openlmt.__helpers import handle_exception

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
    Creates a wrapper around a function call to trace and log its execution metrics.

    This function wraps any given function to measure its execution time,
    log its operation, and trace its execution using OpenTelemetry.
    
    Parameters:
    - gen_ai_endpoint (str): A descriptor or name for the endpoint being traced.
    - version (str): The version of the Langchain application.
    - environment (str): The deployment environment (e.g., 'production', 'development').
    - application_name (str): Name of the Langchain application.
    - tracer (opentelemetry.trace.Tracer): The tracer object used for OpenTelemetry tracing.
    - pricing_info (dict): Information about the pricing for internal metrics (currently not used).
    - trace_content (bool): Flag indicating whether to trace the content of the response.

    Returns:
    - function: A higher-order function that takes a function 'wrapped' and returns
                a new function that wraps 'wrapped' with additional tracing and logging.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        An inner wrapper function that executes the wrapped function, measures execution
        time, and records trace data using OpenTelemetry.

        Parameters:
        - wrapped (Callable): The original function that this wrapper will execute.
        - instance (object): The instance to which the wrapped function belongs. This
                             is used for instance methods. For static and classmethods,
                             this may be None.
        - args (tuple): Positional arguments passed to the wrapped function.
        - kwargs (dict): Keyword arguments passed to the wrapped function.

        Returns:
        - The result of the wrapped function call.
        
        The wrapper initiates a span with the provided tracer, sets various attributes
        on the span based on the function's execution and response, and ensures
        errors are handled and logged appropriately.
        """
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                span.set_attribute("gen_ai.environment", environment)
                span.set_attribute("gen_ai.application_name", application_name)
                span.set_attribute("gen_ai.type", "vectordb")
                span.set_attribute("db.system", "chroma")
                span.set_attribute("db.collection.name", instance.name)

                if gen_ai_endpoint == "chroma.add":
                    span.set_attribute("db.operation", "add")
                    span.set_attribute("db.add.ids_count",
                                       object_count(kwargs.get("ids")))
                    span.set_attribute("db.add.vector_count",
                                       object_count(kwargs.get("embeddings")))
                    span.set_attribute("db.add.metadatas_count",
                                       object_count(kwargs.get("metadatas")))
                    span.set_attribute("db.add.documents_count",
                                       object_count(kwargs.get("documents")))

                elif gen_ai_endpoint == "chroma.get":
                    span.set_attribute("db.operation", "get")
                    span.set_attribute("db.get.ids_count", object_count(kwargs.get("ids")))
                    span.set_attribute("db.get.limit", kwargs.get("limit"))
                    span.set_attribute("db.get.offset", kwargs.get("offset"))
                    span.set_attribute("db.get.where_document",
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.query":
                    span.set_attribute("db.operation", "query")
                    span.set_attribute("db.query.statement", str(kwargs.get("query_texts")))
                    span.set_attribute("db.query.n_results", kwargs.get("n_results", ""))
                    span.set_attribute("db.query.filter", str(kwargs.get("where", "")))
                    span.set_attribute("db.query.where_document",
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.update":
                    span.set_attribute("db.operation", "update")
                    span.set_attribute("db.update.vector_count",
                                       object_count(kwargs.get("embeddings")))
                    span.set_attribute("db.update.metadatas_count",
                                       object_count(kwargs.get("metadatas")))
                    span.set_attribute("db.update.ids_count",
                                       object_count(kwargs.get("ids")))
                    span.set_attribute("db.update.documents_count",
                                       object_count(kwargs.get("documents")))

                elif gen_ai_endpoint == "chroma.upsert":
                    span.set_attribute("db.operation", "upsert")
                    span.set_attribute("db.upsert.vector_count",
                                       object_count(kwargs.get("embeddings")))
                    span.set_attribute("db.upsert.metadatas_count",
                                       object_count(kwargs.get("metadatas")))
                    span.set_attribute("db.upsert.ids_count",
                                       object_count(kwargs.get("ids")))
                    span.set_attribute("db.upsert.documents_count",
                                       object_count(kwargs.get("documents")))

                elif gen_ai_endpoint == "chroma.delete":
                    span.set_attribute("db.operation", "delete")
                    span.set_attribute("db.delete.ids_count",
                                       object_count(kwargs.get("ids")))
                    span.set_attribute("db.delete.filter", str(kwargs.get("where", "")))
                    span.set_attribute("db.delete.delete_all", kwargs.get("delete_all", False))
                    span.set_attribute("db.delete.where_document",
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.peek":
                    span.set_attribute("db.operation", "peek")

                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
