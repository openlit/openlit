# OpenLIT Configuration Guide

OpenLIT provides flexible configuration options through both programmatic initialization (`openlit.init()`) and CLI instrumentation (`openlit-instrument`). All configuration parameters are centrally defined to ensure consistency across both approaches.

## Configuration Methods

### 1. Programmatic Initialization
```python
import openlit

openlit.init(
    service_name="my-app",  # Recommended (replaces application_name)
    environment="production",
    otlp_endpoint="https://cloud.openlit.io",
    # ... other parameters
)
```

### 2. CLI Auto-Instrumentation
```bash
# Using CLI arguments
openlit-instrument --service-name my-app --deployment-environment production python app.py

# Using environment variables (recommended)
OTEL_SERVICE_NAME=my-app OTEL_DEPLOYMENT_ENVIRONMENT=production openlit-instrument python app.py

# Works with any Python command
openlit-instrument flask run
openlit-instrument gunicorn app:app
openlit-instrument uvicorn main:app --host 0.0.0.0 --port 8000
```

## Configuration Parameters

### Core Configuration

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `service_name` | `--service_name` | `OTEL_SERVICE_NAME` | `"default"` | Service name for tracing and metrics |
| `application_name` | `--application_name` | `OTEL_SERVICE_NAME` | `"default"` | **DEPRECATED** - Use `service_name` instead |
| `environment` | `--deployment-environment` | `OTEL_DEPLOYMENT_ENVIRONMENT` | `"default"` | Deployment environment (dev/staging/production) |

### OTLP Export Configuration

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `otlp_endpoint` | `--otlp-endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `None` | OTLP endpoint URL for exporting telemetry data |
| `otlp_headers` | `--otlp-headers` | `OTEL_EXPORTER_OTLP_HEADERS` | `None` | OTLP headers as JSON string |

### Content and Tracing Configuration

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `capture_message_content` | `--capture-message-content` | `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` | Enable capture of AI message content |
| `detailed_tracing` | `--detailed-tracing` | `OPENLIT_DETAILED_TRACING` | `true` | Enable detailed component-level tracing |

### Performance and Batch Configuration

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `disable_batch` | `--disable-batch` | `OPENLIT_DISABLE_BATCH` | `false` | Disable batch span processing |
| `disable_metrics` | `--disable-metrics` | `OPENLIT_DISABLE_METRICS` | `false` | Disable metrics collection entirely |

### Instrumentation Control

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `disabled_instrumentors` | `--disabled-instrumentors` | `OPENLIT_DISABLED_INSTRUMENTORS` | `None` | Comma-separated list of instrumentors to disable |

### GPU and Pricing Configuration

| Parameter | CLI Argument | Environment Variable | Default | Description |
|-----------|--------------|---------------------|---------|-------------|
| `collect_gpu_stats` | `--collect-gpu-stats` | `OPENLIT_COLLECT_GPU_STATS` | `false` | Enable GPU statistics collection |
| `pricing_json` | `--pricing-json` | `OPENLIT_PRICING_JSON` | `None` | File path or URL to custom pricing JSON |

### Internal Parameters (Not Exposed via CLI)

| Parameter | Description |
|-----------|-------------|
| `tracer` | Custom OpenTelemetry tracer instance |
| `event_logger` | Custom OpenTelemetry event logger provider |
| `meter` | Custom OpenTelemetry meter instance |

## Available Instrumentations

OpenLIT automatically detects and instruments the following libraries when present:

### AI/ML Libraries
- **LLM Providers**: OpenAI, Anthropic, Cohere, Mistral, AWS Bedrock, Google Vertex AI, Groq, Ollama, etc.
- **AI Frameworks**: LangChain, LlamaIndex, Haystack, CrewAI, AutoGen, etc.
- **Vector Databases**: Chroma, Pinecone, Qdrant, Milvus, Astra, etc.
- **ML Libraries**: Transformers, vLLM, LiteLLM, etc.

### HTTP Frameworks (OpenTelemetry Official)
- **Web Frameworks**: Flask, Django, FastAPI, Starlette, Pyramid, Falcon, Tornado
- **ASGI/WSGI**: ASGI, WSGI instrumentations

### HTTP Clients (OpenTelemetry Official)
- **HTTP Clients**: requests, httpx, aiohttp-client, urllib, urllib3

## Configuration Precedence

Configuration values are applied in the following order of precedence (highest to lowest):

1. **Environment Variables** (highest precedence)
2. **CLI Arguments** (openlit-instrument only)
3. **Function Parameters** (openlit.init() only)
4. **Default Values** (lowest precedence)

## Usage Examples

### Basic Usage

```python
# Minimal setup
import openlit
openlit.init()

# With custom configuration
openlit.init(
    application_name="my-llm-app",
    environment="production",
    otlp_endpoint="https://cloud.openlit.io"
)
```

### CLI Auto-Instrumentation

```bash
# Basic usage
openlit-instrument python app.py

# With configuration
openlit-instrument --service-name my-app --deployment-environment production python app.py

# With environment variables (recommended)
export OTEL_SERVICE_NAME="my-app"
export OTEL_DEPLOYMENT_ENVIRONMENT="production" 
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.openlit.io"
openlit-instrument python app.py

# Disable specific instrumentations
openlit-instrument --disabled-instrumentors flask,requests python app.py
```

### Framework-Specific Examples

```bash
# Flask applications
OTEL_SERVICE_NAME=flask-app openlit-instrument flask run

# Django applications  
DJANGO_SETTINGS_MODULE=myproject.settings openlit-instrument python manage.py runserver

# FastAPI with Uvicorn
openlit-instrument uvicorn main:app --host 0.0.0.0 --port 8000

# Gunicorn
openlit-instrument gunicorn app:app --workers 4
```

### Environment Variable Configuration

```bash
# Complete configuration via environment variables
export OTEL_SERVICE_NAME="my-ai-service"
export OTEL_DEPLOYMENT_ENVIRONMENT="production"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.openlit.io"
export OTEL_EXPORTER_OTLP_HEADERS='{"authorization":"Bearer your-token"}'
export OPENLIT_DISABLED_INSTRUMENTORS="chromadb,pinecone"
export OPENLIT_COLLECT_GPU_STATS="true"
export OPENLIT_DETAILED_TRACING="true"

# Then simply run
openlit-instrument python app.py
```

## Boolean Environment Variables

For boolean parameters, the following values are considered `true`:
- `true`
- `1` 
- `yes`

All other values (including empty strings) are considered `false`.

## Disabling Instrumentations

You can selectively disable instrumentations by specifying them in a comma-separated list:

```bash
# Disable specific AI/ML instrumentations
OPENLIT_DISABLED_INSTRUMENTORS="openai,anthropic,langchain" openlit-instrument python app.py

# Disable HTTP instrumentations
OPENLIT_DISABLED_INSTRUMENTORS="requests,flask,django" openlit-instrument python app.py

# Mixed disabled instrumentations
OPENLIT_DISABLED_INSTRUMENTORS="openai,requests,flask" openlit-instrument python app.py
```

## Integration with Existing Applications

### Zero-Code Instrumentation
OpenLIT CLI provides zero-code instrumentation - you don't need to modify your existing application code:

```bash
# Before: python app.py
# After: openlit-instrument python app.py
```

### Existing openlit.init() Integration
If your application already uses `openlit.init()`, the CLI will work alongside it:

```python
# Your existing code remains unchanged
import openlit
openlit.init(application_name="my-app")

# Run with CLI for additional HTTP instrumentation
# openlit-instrument python app.py
```

Environment variables will take precedence over `openlit.init()` parameters when using the CLI.

## Troubleshooting

### Missing Instrumentations
If a library isn't being instrumented, check:
1. The library is installed and importable
2. The instrumentor name isn't in `OPENLIT_DISABLED_INSTRUMENTORS`
3. Check logs for instrumentation errors

### CLI Not Working
If `openlit-instrument` command isn't found:
```bash
pip install -e .  # If installing from source
# or
pip install openlit  # If installing from PyPI
```

### Environment Variables Not Working
Ensure environment variables are exported and available to the process:
```bash
env | grep OTEL_  # Check OTEL variables
env | grep OPENLIT_  # Check OpenLIT variables
```

## 🔄 **Parameter Migration Guide**

### `application_name` → `service_name` Migration

The `application_name` parameter is **deprecated** and will be removed in a future version. Please migrate to using `service_name`:

#### Migration Examples

```python
# OLD (deprecated) - will show warning
openlit.init(application_name="my-app")

# NEW (recommended)
openlit.init(service_name="my-app")
```

```bash
# OLD (deprecated) - will show warning
openlit-instrument --application_name my-app python app.py

# NEW (recommended)  
openlit-instrument --service_name my-app python app.py
```

#### Migration Behavior

- **Both parameters supported**: You can use either during migration period
- **`service_name` takes precedence**: If both are provided, `service_name` is used
- **Same environment variable**: Both map to `OTEL_SERVICE_NAME`
- **Silent migration**: No warnings or breaking changes during transition
- **Backward compatibility**: Existing code continues to work unchanged

#### Migration Steps

1. **Replace function calls**: Change `application_name=` to `service_name=`
2. **Replace CLI arguments**: Change `--application_name` to `--service_name`
3. **Environment variables unchanged**: `OTEL_SERVICE_NAME` works with both
4. **Test thoroughly**: Verify your applications work with the new parameter
5. **Remove old parameter**: After migration is complete

The environment variable `OTEL_SERVICE_NAME` remains the same and works with both parameters.