"""
Utility functions for LangChain Community instrumentation.
"""

from opentelemetry.trace import Status, StatusCode
from openlit.semcov import SemanticConvention

def process_general_response(response, gen_ai_endpoint, server_port, server_address,
                            environment, application_name, span, version="1.0.0"):
    """
    Process general LangChain Community operations (document loading, text splitting) and generate telemetry.
    
    Args:
        response: The response object from the LangChain Community operation
        gen_ai_endpoint: The endpoint identifier for the operation
        server_port: Server port (empty for community operations)
        server_address: Server address (empty for community operations)
        environment: Environment name
        application_name: Application name
        span: OpenTelemetry span
        version: Version string
    
    Returns:
        The original response object
    """

    # Set span attributes for general operations
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN)
    span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT, gen_ai_endpoint)
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
    span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
    span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)

    # Try to extract source information for document loading operations
    if gen_ai_endpoint and "retrieve.load" in gen_ai_endpoint:
        try:
            if hasattr(response, "__iter__") and len(response) > 0:
                # For document loaders, try to get source from first document
                first_doc = response[0]
                if hasattr(first_doc, "metadata") and isinstance(first_doc.metadata, dict):
                    source = first_doc.metadata.get("source", "unknown")
                    span.set_attribute(SemanticConvention.GEN_AI_RETRIEVAL_SOURCE, source)

                # Count number of documents loaded
                span.set_attribute("gen_ai.retrieval.documents.count", len(response))
        except (AttributeError, KeyError, IndexError, TypeError):
            # If we cant extract metadata, just continue without it
            pass

    # For text splitting operations
    elif gen_ai_endpoint and ("split_documents" in gen_ai_endpoint or "create_documents" in gen_ai_endpoint):
        try:
            if hasattr(response, "__iter__") and len(response) > 0:
                # Count number of text chunks created
                span.set_attribute("gen_ai.text_splitter.chunks.count", len(response))

                # Try to get average chunk size
                total_chars = sum(len(doc.page_content) for doc in response if hasattr(doc, "page_content"))
                if total_chars > 0:
                    avg_chunk_size = total_chars // len(response)
                    span.set_attribute("gen_ai.text_splitter.avg_chunk_size", avg_chunk_size)
        except (AttributeError, TypeError):
            # If we cant extract chunk information, just continue without it
            pass

    span.set_status(Status(StatusCode.OK))

    return response
