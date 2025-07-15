"""
Haystack OpenTelemetry instrumentation utility functions
"""
import time
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    record_framework_metrics,
)
from openlit.semcov import SemanticConvention

# Operation mapping for Haystack framework operations
OPERATION_MAP = {
    # Workflow-level operations (always instrumented)
    "haystack.pipeline_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.async_pipeline_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.async_generator_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Component-level operations (detailed_tracing=True)
    "haystack.component.document_joiner": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.document_cleaner": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.document_splitter": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.bm25_retriever": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.embedding_retriever": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.openai_generator": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.openai_chat_generator": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.openai_text_embedder": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.openai_document_embedder": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.prompt_builder": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.chat_prompt_builder": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "haystack.component.transformers_similarity_ranker": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
}

def object_count(obj):
    """
    Counts length of object if it exists, else returns 0.
    
    Args:
        obj: Object to count
        
    Returns:
        int: Length of object or 0 if None/empty
    """
    return len(obj) if obj else 0

def set_server_address_and_port(instance):
    """
    Extracts server address and port from Haystack instance.
    
    Args:
        instance: Haystack component or pipeline instance
        
    Returns:
        tuple: (server_address, server_port)
    """
    server_address = "localhost"
    server_port = 8080
    
    # Haystack components typically don't have server configurations
    # Use default values for framework operations
    return server_address, server_port

def common_haystack_logic(scope, environment, application_name, 
    metrics, capture_message_content, disable_metrics, version, 
    instance=None, endpoint=None, **kwargs):
    """
    Process Haystack framework request and generate telemetry.
    
    Args:
        scope: Scope object containing telemetry data
        environment (str): Environment name
        application_name (str): Application name
        metrics: Metrics collection instance
        capture_message_content (bool): Whether to capture content
        disable_metrics (bool): Whether to disable metrics
        version (str): Package version
        instance: Component instance
        endpoint (str): Operation endpoint
        **kwargs: Additional parameters
    """
    scope._end_time = time.time()

    # Set common framework span attributes using centralized helper
    common_framework_span_attributes(scope, SemanticConvention.GEN_AI_SYSTEM_HAYSTACK,
        scope._server_address, scope._server_port, environment, application_name, 
        version, endpoint, instance)

    # Handle operation-specific attributes
    if scope._operation_type == SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK:
        
        # Pipeline-level operations
        if endpoint in ["haystack.pipeline_run", "haystack.async_pipeline_run", "haystack.async_generator_run"]:
            # Track pipeline execution
            scope._span.set_attribute("gen_ai.haystack.operation_type", "pipeline")
            
            if hasattr(scope, "_kwargs") and scope._kwargs:
                # Track pipeline input parameters
                if "data" in scope._kwargs:
                    input_data = scope._kwargs["data"]
                    if isinstance(input_data, dict):
                        input_keys = list(input_data.keys())
                        scope._span.set_attribute("gen_ai.haystack.input_keys", str(input_keys))
                        scope._span.set_attribute("gen_ai.haystack.input_count", len(input_keys))
                
                # Track pipeline configuration
                if "include_outputs_from" in scope._kwargs:
                    scope._span.set_attribute("gen_ai.haystack.include_outputs_from", 
                        str(scope._kwargs["include_outputs_from"]))
            
            # Track pipeline response
            if hasattr(scope, "_response") and scope._response:
                if isinstance(scope._response, dict):
                    output_keys = list(scope._response.keys())
                    scope._span.set_attribute("gen_ai.haystack.output_keys", str(output_keys))
                    scope._span.set_attribute("gen_ai.haystack.output_count", len(output_keys))
                    
                    # Capture response content if enabled
                    if capture_message_content:
                        response_content = str(scope._response)[:1000]
                        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 
                            response_content)
        
        # Component-level operations
        elif endpoint.startswith("haystack.component."):
            component_type = endpoint.replace("haystack.component.", "")
            scope._span.set_attribute("gen_ai.haystack.operation_type", "component")
            scope._span.set_attribute("gen_ai.haystack.component_type", component_type)
            
            # Track component input/output
            if hasattr(scope, "_args") and scope._args:
                scope._span.set_attribute("gen_ai.haystack.component_inputs_count", 
                    len(scope._args))
            
            if hasattr(scope, "_response") and scope._response:
                if isinstance(scope._response, dict):
                    scope._span.set_attribute("gen_ai.haystack.component_outputs_count", 
                        len(scope._response))
                    
                    # Component-specific handling
                    if "document" in component_type:
                        # Document processing components
                        if "documents" in scope._response:
                            doc_count = object_count(scope._response["documents"])
                            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_DOCUMENTS_COUNT, 
                                doc_count)
                    
                    elif "retriever" in component_type:
                        # Retrieval components
                        if "documents" in scope._response:
                            doc_count = object_count(scope._response["documents"])
                            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_DOCUMENTS_COUNT, 
                                doc_count)
                    
                    elif "generator" in component_type:
                        # Generation components
                        if "replies" in scope._response:
                            reply_count = object_count(scope._response["replies"])
                            scope._span.set_attribute("gen_ai.haystack.reply_count", reply_count)
                    
                    elif "embedder" in component_type:
                        # Embedding components
                        if "embeddings" in scope._response:
                            embedding_count = object_count(scope._response["embeddings"])
                            scope._span.set_attribute("gen_ai.haystack.embedding_count", embedding_count)
                    
                    # Capture response content if enabled
                    if capture_message_content:
                        response_content = str(scope._response)[:1000]
                        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 
                            response_content)

    # Set operation duration
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, 
        scope._end_time - scope._start_time)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics using helper for framework operations (only gen_ai_requests counter)
    if not disable_metrics:
        record_framework_metrics(metrics, scope._operation_type, SemanticConvention.GEN_AI_SYSTEM_HAYSTACK, 
            scope._server_address, scope._server_port, environment, application_name, 
            scope._start_time, scope._end_time)

def process_haystack_response(response, operation_type, server_address, server_port,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, instance=None, 
    args=None, endpoint=None, **kwargs):
    """
    Process Haystack framework response and generate telemetry.
    
    Args:
        response: The response from the Haystack operation
        operation_type (str): Type of operation being performed
        server_address (str): Server address
        server_port (int): Server port
        environment (str): Environment name
        application_name (str): Application name
        metrics: Metrics collection instance
        start_time (float): Operation start time
        span: OpenTelemetry span instance
        capture_message_content (bool): Whether to capture content
        disable_metrics (bool): Whether to disable metrics
        version (str): Package version
        instance: Component instance
        args: Positional arguments
        endpoint (str): Operation endpoint
        **kwargs: Additional keyword arguments
        
    Returns:
        The original response unchanged
    """
    # Create scope object to hold telemetry data
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._operation_type = operation_type
    scope._response = response
    scope._start_time = start_time
    scope._server_address = server_address
    scope._server_port = server_port
    scope._args = args
    scope._kwargs = kwargs
    
    # Process response and generate telemetry
    common_haystack_logic(
        scope, environment, application_name, metrics, 
        capture_message_content, disable_metrics, version,
        instance, endpoint, **kwargs
    )
    
    return response 