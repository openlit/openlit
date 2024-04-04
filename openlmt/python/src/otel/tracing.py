from opentelemetry import trace
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.trace import get_tracer
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, BatchSpanProcessor

is_tracer_provider_set = False
llm_specific_tracers = {}

def setup_tracing(application_name="default", llm_type="general", tracer=None, exporter='console'):
    global is_tracer_provider_set
    global llm_specific_tracers

    unique_tracer_key = f"{application_name}_{llm_type}"
    
    # Check if tracer for this LLM type already exists
    if unique_tracer_key in llm_specific_tracers:
        return llm_specific_tracers[unique_tracer_key]
    
    # Initialize TracerProvider and exporter only if it hasn't been set up
    if not tracer and not is_tracer_provider_set:
        resource = Resource(attributes={SERVICE_NAME: application_name})
        trace.set_tracer_provider(TracerProvider(resource=resource))
        
        if exporter == 'otlp':
            span_exporter = OTLPSpanExporter(endpoint="your_collector_endpoint", insecure=True)
        else:  # default to console as fallback
            span_exporter = ConsoleSpanExporter()
        
        trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(span_exporter))
        
        is_tracer_provider_set = True
    
    # Now that TracerProvider is ensured to be set up, get or create the tracer for the specific LLM
    tracer = trace.get_tracer(unique_tracer_key)
    llm_specific_tracers[unique_tracer_key] = tracer
    
    return tracer
