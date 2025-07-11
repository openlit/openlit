"""
Pinecone OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    create_metrics_attributes,
    common_db_span_attributes,
    record_db_metrics,
    set_server_address_and_port,
)
from openlit.semcov import SemanticConvention

# Operation mapping for simple span naming
DB_OPERATION_MAP = {
    "pinecone.create_index": SemanticConvention.DB_OPERATION_CREATE_INDEX,
    "pinecone.upsert": SemanticConvention.DB_OPERATION_UPSERT,
    "pinecone.query": SemanticConvention.DB_OPERATION_QUERY,
    "pinecone.search": SemanticConvention.DB_OPERATION_QUERY,
    "pinecone.update": SemanticConvention.DB_OPERATION_UPDATE,
    "pinecone.delete": SemanticConvention.DB_OPERATION_DELETE,
    "pinecone.upsert_records": SemanticConvention.DB_OPERATION_UPSERT,
    "pinecone.search_records": SemanticConvention.DB_OPERATION_QUERY,
}

def object_count(obj):
    """
    Counts length of object if it exists, else returns 0.
    """
    if obj:
        return len(obj)
    return 0

def format_vectors(vectors):
    """
    Format vectors for telemetry capture.
    """
    if not vectors:
        return ""
    
    if isinstance(vectors, list):
        return f"Vector count: {len(vectors)}"
    return "Vector data"

def common_vectordb_logic(scope, environment, application_name, 
    metrics, capture_message_content, disable_metrics, version, instance=None):
    """
    Process vector database request and generate telemetry.
    """
    
    scope._end_time = time.time()
    
    # Process response and extract metrics where possible
    if hasattr(scope._response, "matches") and scope._response.matches:
        # For query operations, set returned rows count
        scope._span.set_attribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, len(scope._response.matches))
    elif hasattr(scope._response, "upserted_count"):
        # For upsert operations, set returned rows count
        scope._span.set_attribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, scope._response.upserted_count)
    
    # Set operation-specific attributes
    scope._span.set_attribute(SemanticConvention.DB_OPERATION_NAME, scope._db_operation)
    
    if scope._db_operation == SemanticConvention.DB_OPERATION_CREATE_INDEX:
        # Standard database attributes
        scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, scope._kwargs.get("name", ""))
        
        # Vector database specific attributes (extensions)
        scope._span.set_attribute(SemanticConvention.DB_INDEX_NAME, scope._kwargs.get("name", ""))
        scope._span.set_attribute(SemanticConvention.DB_INDEX_DIMENSION, scope._kwargs.get("dimension", ""))
        scope._span.set_attribute(SemanticConvention.DB_INDEX_METRIC, scope._kwargs.get("metric", ""))
        scope._span.set_attribute(SemanticConvention.DB_INDEX_SPEC, str(scope._kwargs.get("spec", "")))
        
    elif scope._db_operation == SemanticConvention.DB_OPERATION_QUERY:
        # Standard database attributes
        scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(scope._kwargs.get("query", "") or scope._args[1] if len(scope._args) > 1 else ""))
        scope._span.set_attribute(SemanticConvention.DB_NAMESPACE,
            str(scope._kwargs.get("namespace", "") or (scope._args[0] if scope._args else "")))
        
        # Vector database specific attributes (extensions)
        scope._span.set_attribute(SemanticConvention.DB_N_RESULTS, scope._kwargs.get("top_k", ""))
        scope._span.set_attribute(SemanticConvention.DB_FILTER, str(scope._kwargs.get("filter", "")))
        
        # Generate query summary for better grouping
        top_k = scope._kwargs.get("top_k", "unknown")
        has_filter = bool(scope._kwargs.get("filter"))
        namespace = scope._kwargs.get("namespace", "default") or (scope._args[0] if scope._args else "unknown")
        scope._span.set_attribute(SemanticConvention.DB_QUERY_SUMMARY, 
                                 f"QUERY {namespace} top_k={top_k} filtered={has_filter}")
        
    elif scope._db_operation == SemanticConvention.DB_OPERATION_UPDATE:
        # Standard database attributes
        scope._span.set_attribute(SemanticConvention.DB_NAMESPACE,
            str(scope._kwargs.get("namespace", "") or (scope._args[0] if scope._args else "")))
        
        # Vector database specific attributes (extensions)
        scope._span.set_attribute(SemanticConvention.DB_UPDATE_ID, scope._kwargs.get("id", ""))
        scope._span.set_attribute(SemanticConvention.DB_UPDATE_VALUES, str(scope._kwargs.get("values", [])))
        scope._span.set_attribute(SemanticConvention.DB_UPDATE_METADATA, str(scope._kwargs.get("set_metadata", "")))
        
    elif scope._db_operation == SemanticConvention.DB_OPERATION_UPSERT:
        # Standard database attributes
        scope._span.set_attribute(SemanticConvention.DB_NAMESPACE,
            str(scope._kwargs.get("namespace", "") or (scope._args[0] if scope._args else "")))
        
        # Vector database specific attributes (extensions)
        vector_count = object_count(scope._kwargs.get("vectors") or (scope._args[1] if len(scope._args) > 1 else None))
        scope._span.set_attribute(SemanticConvention.DB_VECTOR_DIMENSION_COUNT, vector_count)

        scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(scope._kwargs.get("vectors", "") or scope._args[1] or ""))
        
        # Set returned rows for metrics (number of vectors upserted)
        scope._span.set_attribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, vector_count)
        
    elif scope._db_operation == SemanticConvention.DB_OPERATION_DELETE:
        # Standard database attributes
        scope._span.set_attribute(SemanticConvention.DB_NAMESPACE,
            str(scope._kwargs.get("namespace", "") or (scope._args[0] if scope._args else "")))
        
        # Vector database specific attributes (extensions)
        scope._span.set_attribute(SemanticConvention.DB_ID_COUNT, object_count(scope._kwargs.get("ids")))
        scope._span.set_attribute(SemanticConvention.DB_FILTER, str(scope._kwargs.get("filter", "")))
        scope._span.set_attribute(SemanticConvention.DB_DELETE_ALL, scope._kwargs.get("delete_all", False))
    
    # Set common database span attributes using helper
    common_db_span_attributes(scope, SemanticConvention.DB_SYSTEM_PINECONE, scope._server_address, scope._server_port,
        environment, application_name, version)
    
    # Set operation duration
    scope._span.set_attribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, scope._end_time - scope._start_time)
            
    scope._span.set_status(Status(StatusCode.OK))
    
    # Record metrics using helper
    if not disable_metrics:
        record_db_metrics(metrics, SemanticConvention.DB_SYSTEM_PINECONE, scope._server_address, scope._server_port,
            environment, application_name, scope._start_time, scope._end_time)

def process_vectordb_response(response, db_operation, server_address, server_port, 
    environment, application_name, metrics, start_time, span, 
    capture_message_content=False, disable_metrics=False, 
    version="1.0.0", instance=None, args=None, **kwargs):
    """
    Process vector database response and generate telemetry following OpenTelemetry conventions.
    """
    
    scope = type("GenericScope", (), {})()
    
    scope._start_time = start_time
    scope._span = span
    scope._kwargs = kwargs
    scope._args = args or []
    scope._db_operation = db_operation
    scope._response = response
    scope._server_address = server_address
    scope._server_port = server_port
    
    common_vectordb_logic(scope, environment, application_name,
                         metrics, capture_message_content, disable_metrics, version, instance)
    
    return response 