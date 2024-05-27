# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring ChromaDB.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def object_count(obj):
    """
    Counts Length of object if it exists, Else returns None
    """
    try:
        cnt = len(obj)
    # pylint: disable=bare-except
    except:
        cnt = 0

    return cnt

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                   gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                   environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                   application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                   SemanticConvetion.GEN_AI_TYPE_VECTORDB)
                span.set_attribute(SemanticConvetion.DB_SYSTEM,
                                   SemanticConvetion.DB_SYSTEM_CHROMA)
                span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                   instance.name)

                if gen_ai_endpoint == "chroma.add":
                    db_operation = SemanticConvetion.DB_OPERATION_ADD
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_ADD)
                    span.set_attribute(SemanticConvetion.DB_ID_COUNT,
                                       object_count(kwargs.get("ids", [])))
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("embeddings", [])))
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("metadatas", [])))
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       object_count(kwargs.get("documents", [])))

                elif gen_ai_endpoint == "chroma.get":
                    db_operation = SemanticConvetion.DB_OPERATION_GET
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_GET)
                    span.set_attribute(SemanticConvetion.DB_ID_COUNT,
                                       object_count(kwargs.get("ids", [])))
                    span.set_attribute(SemanticConvetion.DB_QUERY_LIMIT,
                                       kwargs.get("limit", ""))
                    span.set_attribute(SemanticConvetion.DB_OFFSET,
                                       kwargs.get("offset", ""))
                    span.set_attribute(SemanticConvetion.DB_WHERE_DOCUMENT,
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.query":
                    db_operation = SemanticConvetion.DB_OPERATION_QUERY
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_QUERY)
                    span.set_attribute(SemanticConvetion.DB_STATEMENT,
                                       str(kwargs.get("query_texts", "")))
                    span.set_attribute(SemanticConvetion.DB_N_RESULTS,
                                       kwargs.get("n_results", ""))
                    span.set_attribute(SemanticConvetion.DB_FILTER,
                                       str(kwargs.get("where", "")))
                    span.set_attribute(SemanticConvetion.DB_WHERE_DOCUMENT,
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.update":
                    db_operation = SemanticConvetion.DB_OPERATION_UPDATE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_UPDATE)
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("embeddings", [])))
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("metadatas", [])))
                    span.set_attribute(SemanticConvetion.DB_ID_COUNT,
                                       object_count(kwargs.get("ids", [])))
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       object_count(kwargs.get("documents", [])))

                elif gen_ai_endpoint == "chroma.upsert":
                    db_operation = SemanticConvetion.DB_OPERATION_UPSERT
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_UPSERT)
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("embeddings", [])))
                    span.set_attribute(SemanticConvetion.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("metadatas", [])))
                    span.set_attribute(SemanticConvetion.DB_ID_COUNT,
                                       object_count(kwargs.get("ids", [])))
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       object_count(kwargs.get("documents", [])))

                elif gen_ai_endpoint == "chroma.delete":
                    db_operation = SemanticConvetion.DB_OPERATION_DELETE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_DELETE)
                    span.set_attribute(SemanticConvetion.DB_ID_COUNT,
                                       object_count(kwargs.get("ids", [])))
                    span.set_attribute(SemanticConvetion.DB_FILTER,
                                       str(kwargs.get("where", "")))
                    span.set_attribute(SemanticConvetion.DB_DELETE_ALL,
                                       kwargs.get("delete_all", False))
                    span.set_attribute(SemanticConvetion.DB_WHERE_DOCUMENT,
                                       str(kwargs.get("where_document", "")))

                elif gen_ai_endpoint == "chroma.peek":
                    db_operation = SemanticConvetion.DB_OPERATION_PEEK
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       SemanticConvetion.DB_OPERATION_PEEK)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.DB_SYSTEM:
                            SemanticConvetion.DB_SYSTEM_CHROMA,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_VECTORDB,
                        SemanticConvetion.DB_OPERATION:
                            db_operation
                    }

                    metrics["db_requests"].add(1, attributes)

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
