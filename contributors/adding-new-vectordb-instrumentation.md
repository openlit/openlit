# Vector Database Instrumentation Guide

This guide provides step-by-step instructions for adding a new vector database instrumentation to OpenLIT, following the established patterns and conventions.

## Table of Contents
1. [File Structure](#file-structure)
2. [Code Structure](#code-structure)
3. [Naming Conventions](#naming-conventions)
4. [Code Style Guidelines](#code-style-guidelines)
5. [Implementation Steps](#implementation-steps)
6. [Testing](#testing)
7. [Integration](#integration)

## File Structure

Every vector database instrumentation follows a consistent **4-file structure**:

```
sdk/python/src/openlit/instrumentation/{database_name}/
├── __init__.py          # Instrumentor class with dependency requirements
├── {database_name}.py   # Sync wrapper functions
├── async_{database_name}.py  # Async wrapper functions
└── utils.py            # Telemetry processing logic
```

### Example Structure (using "pinecone" as example):
```
sdk/python/src/openlit/instrumentation/pinecone/
├── __init__.py
├── pinecone.py
├── async_pinecone.py
└── utils.py
```

## Code Structure

### 1. DB_OPERATION_MAP Pattern

All vector database instrumentations use a centralized operation mapping in `utils.py`:

```python
# Operation mapping for simple span naming
DB_OPERATION_MAP = {
    "{database}.create_index": SemanticConvention.DB_OPERATION_CREATE_INDEX,
    "{database}.upsert": SemanticConvention.DB_OPERATION_UPSERT,
    "{database}.query": SemanticConvention.DB_OPERATION_QUERY,
    "{database}.search": SemanticConvention.DB_OPERATION_SEARCH,
    "{database}.fetch": SemanticConvention.DB_OPERATION_FETCH,
    "{database}.update": SemanticConvention.DB_OPERATION_UPDATE,
    "{database}.delete": SemanticConvention.DB_OPERATION_DELETE,
}
```

### 2. General Wrap Pattern

Use the **general_wrap** pattern for efficiency:

```python
def general_wrap(endpoint, version, environment, application_name, tracer, 
                pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Create a wrapper for {database} operations using the general wrap pattern.
    """
    def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)
        
        # Extract operation from endpoint
        db_operation = DB_OPERATION_MAP.get(endpoint, "unknown")
        
        # Server address calculation
        server_address, server_port = set_server_address_and_port(
            instance, "default-host", default_port
        )
        
        # CRITICAL: Use tracer.start_as_current_span() for proper context
        with tracer.start_as_current_span(f"{db_operation} {target}") as span:
            start_time = time.time()
            
            try:
                response = wrapped(*args, **kwargs)
                
                # Process response
                process_vectordb_response(
                    response, db_operation, server_address, server_port,
                    environment, application_name, metrics, start_time, span,
                    capture_message_content, disable_metrics, version, 
                    instance, args, **kwargs
                )
                
                return response
            except Exception as e:
                handle_exception(span, e)
                raise
    
    return wrapper
```

### 3. Helper Functions

Include standard helper functions in `utils.py`:

```python
def object_count(obj):
    """
    Counts length of object if it exists, else returns 0.
    """
    return len(obj) if obj else 0

def common_vectordb_logic(scope, environment, application_name, 
    metrics, capture_message_content, disable_metrics, version, instance=None):
    """
    Process vector database request and generate telemetry.
    """
    # Implementation details...
```

## Naming Conventions

### 1. File Names
- Use lowercase with underscores: `{database_name}.py`
- Async files: `async_{database_name}.py`
- No hyphens, use underscores

### 2. Function Names
- Use `snake_case` consistently
- Standard function names:
  - `general_wrap`
  - `async_general_wrap`
  - `common_vectordb_logic`
  - `process_vectordb_response`

### 3. Variable Names
- Use `snake_case` for all variables
- Standard variable names:
  - `server_address`, `server_port`
  - `start_time`, `end_time`
  - `db_operation`
  - `namespace`

### 4. Class Names
- Use `PascalCase` for classes
- Instrumentor class: `{DatabaseName}Instrumentor`

## Code Style Guidelines

### 1. Quotes
- **Always use double quotes** for strings: `"example"`
- Consistent across all files

### 2. Indentation
- **4 spaces** for indentation
- No tabs

### 3. Comments
- **Triple double quotes** for docstrings:
  ```python
  def function_name():
      """
      Function description.
      """
  ```
- Single line comments use `#`

### 4. Import Order
Follow this specific order:
```python
# Standard library imports
import time

# OpenTelemetry imports
from opentelemetry.trace import Status, StatusCode
from opentelemetry import context as context_api

# OpenLIT imports
from openlit.__helpers import (
    common_db_span_attributes,
    record_db_metrics,
    handle_exception,
)
from openlit.semcov import SemanticConvention
```

### 5. Function Parameters
Standard parameter order:
```python
def function_name(version, environment, application_name, tracer, 
                 pricing_info, capture_message_content, metrics, disable_metrics):
```

## Implementation Steps

### Step 1: Create Directory Structure
```bash
mkdir -p sdk/python/src/openlit/instrumentation/{database_name}
```

### Step 2: Create __init__.py
```python
"""
OpenLIT {DatabaseName} Instrumentation
"""

from typing import Collection
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.instrumentation.utils import unwrap
from wrapt import wrap_function_wrapper

from openlit.instrumentation.{database_name}.{database_name} import general_wrap
from openlit.instrumentation.{database_name}.async_{database_name} import async_general_wrap

class {DatabaseName}Instrumentor(BaseInstrumentor):
    """
    OpenLIT Instrumentor for {DatabaseName}
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ["{database-package-name}"]

    def _instrument(self, **kwargs):
        """
        Instrument {DatabaseName} operations
        """
        # Extract parameters
        version = kwargs.get("version", "1.0.0")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics")
        disable_metrics = kwargs.get("disable_metrics", False)

        # Wrap functions
        wrap_function_wrapper(
            "{database_module}",
            "{Class}.{method}",
            general_wrap(
                "{database}.{operation}",
                version, environment, application_name, tracer,
                pricing_info, capture_message_content, metrics, disable_metrics
            ),
        )

    def _uninstrument(self, **kwargs):
        """
        Uninstrument {DatabaseName} operations
        """
        unwrap({database_module}.{Class}, "{method}")
```

### Step 3: Create Wrapper Files
Create both sync and async wrapper files following the general_wrap pattern.

### Step 4: Create utils.py
Include:
- `DB_OPERATION_MAP`
- `object_count` helper
- `common_vectordb_logic`
- `process_vectordb_response`

### Step 5: Operation-Specific Attributes
Handle different operations in `common_vectordb_logic`:

```python
if scope._db_operation == SemanticConvention.DB_OPERATION_CREATE_INDEX:
    # Standard database attributes
    scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, scope._kwargs.get("name", ""))
    
    # Vector database specific attributes
    scope._span.set_attribute(SemanticConvention.DB_COLLECTION_DIMENSION, scope._kwargs.get("dimension", -1))
    scope._span.set_attribute(SemanticConvention.DB_SEARCH_SIMILARITY_METRIC, scope._kwargs.get("metric", "cosine"))

elif scope._db_operation == SemanticConvention.DB_OPERATION_QUERY:
    namespace = scope._kwargs.get("namespace", "default") or (scope._args[0] if scope._args else "unknown")
    query = scope._kwargs.get("vector", [])
    
    # Standard database attributes
    scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(query))
    scope._span.set_attribute(SemanticConvention.DB_NAMESPACE, namespace)
    
    # Vector database specific attributes
    scope._span.set_attribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, scope._kwargs.get("top_k", -1))
    scope._span.set_attribute(SemanticConvention.DB_FILTER, str(scope._kwargs.get("filter", "")))
    scope._span.set_attribute(SemanticConvention.DB_QUERY_SUMMARY, 
        f"{scope._db_operation} {namespace} "
        f"top_k={scope._kwargs.get('top_k', -1)} "
        f"filtered={scope._kwargs.get('filter', '')} "
        f"vector={scope._kwargs.get('vector', '')}")
```

### Step 6: Usage and Metrics Extraction
Handle response processing and usage metrics:

```python
# Extract usage information if available
if scope._response.get("usage"):
    usage = scope._response["usage"]
    embed_tokens = usage.get("embed_total_tokens", 0)
    read_units = usage.get("read_units", 0)
    if embed_tokens:
        scope._span.set_attribute(SemanticConvention.DB_CLIENT_TOKEN_USAGE, embed_tokens)
    if read_units:
        scope._span.set_attribute("db.read_units", read_units)
```

## Testing

### Create Test File
Create `sdk/python/tests/test_{database_name}.py`:

```python
"""
Tests for {DatabaseName} functionality using the {DatabaseName} Python library.
"""

import pytest
import openlit
from {database_package} import {ClientClass}

# Initialize client
client = {ClientClass}()

# Initialize OpenLIT
openlit.init(environment="openlit-python-testing", application_name="openlit-python-{database}-test")

def test_sync_{database}_query():
    """
    Tests synchronous query operation.
    """
    try:
        response = client.query(
            # parameters
        )
        assert response  # Add appropriate assertions
        
    except Exception as e:
        if "rate limit" in str(e).lower() or "429" in str(e):
            print("Rate limit exceeded:", e)
        elif "credit" in str(e).lower():
            print("Insufficient balance:", e)
        else:
            raise

@pytest.mark.asyncio
async def test_async_{database}_query():
    """
    Tests asynchronous query operation.
    """
    # Similar structure for async tests
```

## Integration

### Step 1: Add to Base Instrumentation
Add to `sdk/python/src/openlit/instrumentation/__init__.py`:

```python
from openlit.instrumentation.{database_name} import {DatabaseName}Instrumentor

# Add to instrumentors list
def auto_instrument(**kwargs):
    """
    Auto-instrument supported libraries
    """
    # ... existing instrumentors ...
    
    # {DatabaseName} Instrumentation
    try:
        {DatabaseName}Instrumentor().instrument(**kwargs)
    except Exception as e:
        logger.warning(f"Failed to instrument {DatabaseName}: {e}")
```

### Step 2: Add Semantic Conventions
Add any new semantic conventions to `sdk/python/src/openlit/semcov/__init__.py`:

```python
# Vector Database Semantic Conventions
DB_VECTOR_QUERY_TOP_K = "db.vector.query.top_k"
DB_SEARCH_SIMILARITY_METRIC = "db.search.similarity_metric"
DB_COLLECTION_DIMENSION = "db.collection.dimension"
# ... other conventions
```

### Step 3: Update Dependencies
Add the database package to test requirements if needed.

## Key Reminders

1. **Always use `tracer.start_as_current_span()`** - Never use `tracer.start_span()` as it breaks context propagation
2. **Include suppression check** - Always check `context_api._SUPPRESS_INSTRUMENTATION_KEY`
3. **Use consistent patterns** - Follow the established 4-file structure and general_wrap pattern
4. **Handle errors gracefully** - Use `handle_exception()` for proper error handling
5. **Set server address** - Always calculate and set server_address/server_port
6. **Use helper functions** - Utilize `common_db_span_attributes()` and `record_db_metrics()`
7. **Follow naming conventions** - Use semantic convention constants, not hardcoded strings
8. **Test thoroughly** - Include both sync and async tests with error handling

## Example Implementation

For a complete reference implementation, see the Pinecone instrumentation:
- `sdk/python/src/openlit/instrumentation/pinecone/`

This guide ensures consistency across all vector database instrumentations and maintains the high quality standards of the OpenLIT project. 