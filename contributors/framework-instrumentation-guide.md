# Framework Instrumentation Guide for OpenLIT

This guide provides a comprehensive, step-by-step process for adding new framework instrumentations or updating existing ones in OpenLIT. It's based on the optimized Haystack instrumentation and ensures consistency, performance, and competitive advantages across all framework integrations.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Competitive Analysis](#phase-1-competitive-analysis)
3. [Phase 2: Framework Analysis](#phase-2-framework-analysis)
4. [Phase 3: Implementation Structure](#phase-3-implementation-structure)
5. [Phase 4: Code Implementation](#phase-4-code-implementation)
6. [Phase 5: Testing & Validation](#phase-5-testing--validation)
7. [Phase 6: Optimization](#phase-6-optimization)
8. [Phase 7: Post-Change Cleanup](#phase-7-post-change-cleanup)
9. [Code Standards & Patterns](#code-standards--patterns)
10. [Quality Checklist](#quality-checklist)

## Prerequisites

Before starting, ensure you have:
- OpenLIT development environment set up
- Target framework installed and working examples
- Access to competitor repositories for analysis
- Understanding of OpenTelemetry concepts

## Phase 1: Competitive Analysis

### Step 1.1: Research Competitor Implementations

**Primary Competitors:**
- [OpenInference](https://github.com/Arize-ai/openinference/tree/main/python/instrumentation)
- [OpenLLMetry](https://github.com/traceloop/openllmetry/tree/main/packages)

**Research Tasks:**
```bash
# Clone competitor repositories for analysis
git clone https://github.com/Arize-ai/openinference.git
git clone https://github.com/traceloop/openllmetry.git

# Navigate to framework-specific instrumentations
cd openinference/python/instrumentation/openinference-instrumentation-{framework}
cd openllmetry/packages/openllmetry-instrumentation-{framework}
```

**Analysis Checklist:**
- [ ] **Span Structure**: How many spans do they create?
- [ ] **Span Hierarchy**: Do they maintain parent-child relationships?
- [ ] **Attributes**: What attributes do they capture?
- [ ] **Content Capture**: Do they capture input/output content?
- [ ] **Metrics**: What metrics do they track?
- [ ] **Performance**: How much overhead do they add?
- [ ] **Coverage**: Which framework operations do they instrument?

### Step 1.2: Document Competitor Strengths & Gaps

Create a comparison table:

| Feature | OpenInference | OpenLLMetry | OpenLIT Target |
|---------|---------------|-------------|----------------|
| Span Count | X spans | Y spans | Z spans (optimal) |
| Technical Detail | High/Medium/Low | High/Medium/Low | Enhanced |
| Business Intelligence | High/Medium/Low | High/Medium/Low | Complete |
| Content Capture | Yes/No/Partial | Yes/No/Partial | Full |
| Cost Tracking | Yes/No | Yes/No | Yes |
| Performance Impact | X ms | Y ms | Minimal |

## Phase 2: Framework Analysis

### Step 2.1: Understand Framework Architecture

**Key Questions:**
- What are the main execution flows?
- Which operations should be workflow-level vs component-level?
- Does the framework have built-in monitoring/tracing?
- What are the most important operations for users?

**Framework Mapping:**
```python
# Example for any framework
WORKFLOW_OPERATIONS = [
    # High-level operations users care about
    "pipeline.run",
    "agent.execute", 
    "workflow.process"
]

COMPONENT_OPERATIONS = [
    # Detailed operations for debugging
    "retriever.retrieve",
    "generator.generate",
    "embedder.embed"
]
```

### Step 2.2: Test Built-in Framework Monitoring

Create test scripts to understand framework's native instrumentation:

```python
# test_framework_native.py
import {framework}
# Enable any built-in tracing/monitoring
# Run sample operations
# Document what spans/metrics are created natively
```

### Step 2.3: Identify OpenLIT Enhancement Opportunities

**Enhancement Areas:**
- [ ] Business metrics (cost, tokens, performance)
- [ ] Content capture (prompts, responses)
- [ ] Cross-system tracing (LLM provider integration)
- [ ] Advanced attributes (model details, usage patterns)
- [ ] Performance optimization

## Phase 3: Implementation Structure

### Step 3.1: Create Directory Structure

```
sdk/python/src/openlit/instrumentation/{framework}/
├── __init__.py              # Instrumentor class (70-100 lines)
├── {framework}.py           # Sync wrapper (50-60 lines)
├── async_{framework}.py     # Async wrapper (50-60 lines)
└── utils.py                 # Processing logic (200-400 lines)
```

### Step 3.2: Define Operation Mapping

In `utils.py`, create centralized operation mapping:

```python
# Operation mapping for semantic conventions
OPERATION_MAP = {
    "pipeline": "workflow",
    "agent.execute": "agent",
    "retriever.retrieve": "retrieve", 
    "generator.generate": "generate",
    # Map framework operations to semantic operation types
}
```

### Step 3.3: Plan Instrumentation Levels

**Workflow Level (Always Enabled):**
- High-level operations users monitor in production
- Minimal span count for performance
- Essential business metrics

**Component Level (detailed_tracing=True):**
- Detailed operations for debugging
- Comprehensive technical attributes
- Enhanced framework introspection

## Phase 4: Code Implementation

### Step 4.1: Implement __init__.py

Follow the optimized pattern:

```python
"""
OpenLIT {Framework} Instrumentation - Optimized for Performance
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.{framework}.{framework} import general_wrap
from openlit.instrumentation.{framework}.async_{framework} import async_general_wrap

_instruments = ("{framework}-package >= X.Y.Z",)

class {Framework}Instrumentor(BaseInstrumentor):
    """Optimized instrumentor for {Framework} with minimal overhead"""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("{framework}-package")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        # Workflow operations (always enabled)
        try:
            wrap_function_wrapper(
                "{framework}.module", "Class.method",
                general_wrap("operation_type", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics)
            )
        except Exception:
            pass  # Handle missing modules gracefully

        # Component operations (only if detailed_tracing enabled)
        if detailed_tracing:
            components = [
                ("{framework}.module", "Component.method", "component_type"),
                # List all component operations
            ]
            
            for module, method, component_type in components:
                try:
                    wrap_function_wrapper(
                        module, method,
                        general_wrap(component_type, version, environment, application_name, tracer,
                            pricing_info, capture_message_content, metrics, disable_metrics)
                    )
                except Exception:
                    pass  # Each component wrapped individually

    def _uninstrument(self, **kwargs):
        pass
```

### Step 4.2: Implement Sync Wrapper

In `{framework}.py`:

```python
"""
Sync wrapper for {Framework} operations
"""

from opentelemetry import context as context_api
from openlit.instrumentation.{framework}.utils import general_wrap_sync

def general_wrap(operation_type, version, environment, application_name, tracer, 
                pricing_info, capture_message_content, metrics, disable_metrics):
    """
    General wrapper for {Framework} operations with optimized performance
    """
    def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Check instrumentation suppression
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        return general_wrap_sync(
            wrapped, instance, args, kwargs,
            operation_type, version, environment, application_name, tracer,
            pricing_info, capture_message_content, metrics, disable_metrics
        )
    
    return wrapper
```

### Step 4.3: Implement Async Wrapper

In `async_{framework}.py`:

```python
"""
Async wrapper for {Framework} operations  
"""

from opentelemetry import context as context_api
from openlit.instrumentation.{framework}.utils import general_wrap_async

def async_general_wrap(operation_type, version, environment, application_name, tracer,
                      pricing_info, capture_message_content, metrics, disable_metrics):
    """
    General async wrapper for {Framework} operations
    """
    def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Check instrumentation suppression
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        return general_wrap_async(
            wrapped, instance, args, kwargs,
            operation_type, version, environment, application_name, tracer,
            pricing_info, capture_message_content, metrics, disable_metrics
        )
    
    return wrapper
```

### Step 4.4: Implement Utils.py

Core processing logic with comprehensive telemetry:

```python
"""
Utility functions for {Framework} instrumentation
"""

import time
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    record_framework_metrics,
    format_content
)
from openlit.semcov import SemanticConvention

# Operation mapping for semantic conventions
OPERATION_MAP = {
    "pipeline": "workflow",
    "component": "component",
    # Add framework-specific mappings
}

def general_wrap_sync(wrapped, instance, args, kwargs, operation_type, version, environment, 
                     application_name, tracer, pricing_info, capture_message_content, 
                     metrics, disable_metrics):
    """
    Synchronous wrapper with comprehensive telemetry
    """
    # Extract operation details
    gen_ai_endpoint = OPERATION_MAP.get(operation_type, operation_type)
    
    # Create span name following pattern: "{operation_type} {component/model}"
    component_name = _extract_component_name(instance, operation_type)
    span_name = f"{gen_ai_endpoint} {component_name}"

    with tracer.start_as_current_span(span_name) as span:
        try:
            # Set common framework attributes
            _set_common_attributes(span, operation_type, instance, version, 
                                 environment, application_name, gen_ai_endpoint)
            
            # Record request details
            _record_request_details(span, args, kwargs, capture_message_content)
            
            # Execute operation
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()
            
            # Process response
            try:
                _process_response(span, response, operation_type, capture_message_content)
                span.set_status(Status(StatusCode.OK))
            except Exception as e:
                handle_exception(span, e)
                
            # Record metrics
            if not disable_metrics and metrics:
                _record_operation_metrics(metrics, operation_type, start_time, end_time, 
                                        environment, application_name)
                
        except Exception as e:
            handle_exception(span, e)
            raise
            
        return response

def _extract_component_name(instance, operation_type):
    """Extract component name for span naming"""
    if hasattr(instance, '__class__'):
        return instance.__class__.__name__.lower()
    return operation_type

def _set_common_attributes(span, operation_type, instance, version, environment, 
                          application_name, gen_ai_endpoint):
    """Set common framework span attributes"""
    # Use centralized helper for standard attributes
    common_framework_span_attributes(
        span, "{framework}", None, None, environment, 
        application_name, version, gen_ai_endpoint, instance
    )
    
    # Framework-specific attributes
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION_TYPE, operation_type)

def _record_request_details(span, args, kwargs, capture_message_content):
    """Record request parameters and content"""
    try:
        # Extract and record input parameters
        if capture_message_content:
            # Record input content based on framework patterns
            pass
            
        # Record technical parameters
        _extract_technical_details(span, args, kwargs)
        
    except Exception:
        pass  # Don't fail instrumentation for attribute errors

def _process_response(span, response, operation_type, capture_message_content):
    """Process and record response details"""
    try:
        if capture_message_content:
            # Record output content
            pass
            
        # Extract business metrics (tokens, cost, etc.)
        _extract_business_metrics(span, response)
        
        # Extract technical framework details  
        _extract_framework_details(span, response, operation_type)
        
    except Exception:
        pass  # Don't fail instrumentation for response processing

def _extract_technical_details(span, args, kwargs):
    """Extract technical framework details for enhanced observability"""
    # Component specifications
    # Input/output types
    # Framework-specific parameters
    pass

def _extract_business_metrics(span, response):
    """Extract business intelligence metrics"""
    # Token usage
    # Cost calculations
    # Performance metrics
    pass

def _extract_framework_details(span, response, operation_type):
    """Extract framework-specific technical details"""
    # Use semantic conventions from semcov
    # Component connections
    # Pipeline metadata
    # Execution details
    pass

def _record_operation_metrics(metrics, operation_type, start_time, end_time, 
                            environment, application_name):
    """Record framework operation metrics"""
    record_framework_metrics(
        metrics, "{framework}", None, None, environment, 
        application_name, start_time, end_time
    )

# Async version
async def general_wrap_async(wrapped, instance, args, kwargs, operation_type, version, 
                           environment, application_name, tracer, pricing_info, 
                           capture_message_content, metrics, disable_metrics):
    """
    Asynchronous wrapper - mirrors sync implementation
    """
    # Same logic as sync version but with async/await
    pass
```

## Phase 5: Testing & Validation

### Step 5.1: Create Test Scripts

**Basic Functionality Test:**
```python
# test_basic_instrumentation.py
import openlit
from {framework} import *

# Initialize with different configurations
openlit.init(detailed_tracing=False)  # Workflow only
openlit.init(detailed_tracing=True)   # Full instrumentation

# Test basic operations
# Verify span creation and attributes
```

**Comparison Test:**
```python
# test_competitive_comparison.py
# Compare span count, attributes, and performance with competitors
# Document improvements and advantages
```

### Step 5.2: Validation Checklist

- [ ] **Span Creation**: Correct number and hierarchy of spans
- [ ] **Span Naming**: Follows `{operation_type} {component}` pattern
- [ ] **Attributes**: Uses semantic conventions from semcov
- [ ] **Content Capture**: Captures input/output when enabled
- [ ] **Error Handling**: Graceful failure for missing components
- [ ] **Performance**: Minimal overhead impact
- [ ] **Cross-System**: Integrates with LLM provider instrumentations

## Phase 6: Optimization

### Step 6.1: Performance Optimization

**Metrics to Track:**
- Line count reduction (target: 60-70% of original)
- Execution overhead (target: <5ms per operation)
- Memory usage impact
- Span creation efficiency

### Step 6.2: Code Efficiency

**Optimization Patterns:**
- Use `general_wrap` pattern instead of individual wrappers
- Centralize operation mapping in `OPERATION_MAP`
- Leverage common helper functions
- Implement lazy loading for expensive operations

### Step 6.3: Competitive Validation Testing

**Critical Testing Requirements:**
After implementation, create comprehensive competitive tests to validate superiority:

```python
# competitive_test.py - Test against OpenInference and OpenLLMetry
import openlit
import opentelemetry
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

def test_openlit_vs_competitors():
    """
    Test OpenLIT against competitors for reliability and span generation
    """
    
    # Test OpenLIT implementation
    openlit.init(detailed_tracing=True)
    spans_openlit = run_framework_operations()
    
    # Test competitor implementations (with error handling)
    try:
        # Configure competitor tracing
        spans_competitor1 = test_competitor_implementation("openinference")
        spans_competitor2 = test_competitor_implementation("openllmetry")
    except Exception as e:
        print(f"Competitor failed: {e}")
        spans_competitor1 = spans_competitor2 = 0
    
    # Validate OpenLIT superiority
    assert spans_openlit > 0, "OpenLIT must generate spans"
    assert spans_openlit >= spans_competitor1, "OpenLIT should match/exceed competitor spans"
    assert spans_openlit >= spans_competitor2, "OpenLIT should match/exceed competitor spans"
    
    print(f"OpenLIT: {spans_openlit} spans")
    print(f"Competitor 1: {spans_competitor1} spans") 
    print(f"Competitor 2: {spans_competitor2} spans")
```

**Validation Success Criteria:**
- OpenLIT generates spans when competitors fail
- OpenLIT span count >= competitor span count  
- OpenLIT provides enhanced business intelligence
- OpenLIT demonstrates better error resilience
- OpenLIT shows superior OpenTelemetry SDK compatibility

### Step 6.4: Error Resilience Validation

**Version Compatibility Testing:**
```python
# Test across different OpenTelemetry SDK versions
def test_version_compatibility():
    """Test instrumentation works across SDK versions"""
    sdk_versions = ["1.19.0", "1.20.0", "1.21.0", "latest"]
    
    for version in sdk_versions:
        try:
            # Test with specific SDK version
            test_result = run_instrumentation_test(sdk_version=version)
            assert test_result.spans_generated > 0
            print(f"✅ Compatible with OpenTelemetry SDK {version}")
        except Exception as e:
            print(f"❌ Failed with SDK {version}: {e}")
```

**Framework Version Testing:**
```python
# Test across different framework versions
def test_framework_compatibility():
    """Test instrumentation gracefully handles missing components"""
    
    # Test with minimal framework installation
    # Test with full framework installation  
    # Test with missing optional components
    # Verify graceful degradation in all cases
```

## Phase 7: Post-Change Cleanup

**CRITICAL**: After implementing any changes, always run comprehensive cleanup to ensure code quality compliance.

### Step 7.1: Run Pylint Checks

```bash
# Check specific issues that commonly occur after changes
pylint --disable=all --enable=line-too-long,trailing-whitespace,missing-final-newline,trailing-newlines,syntax-error,unused-import,consider-iterating-dictionary,consider-using-in,too-many-nested-blocks src/openlit/instrumentation/{framework}/
```

### Step 7.2: Common Issues and Automated Fixes

**1. Trailing Whitespace (C0303)**
```bash
# Remove trailing whitespace from all files
for file in $(find src/openlit/instrumentation/{framework} -name "*.py"); do
    sed 's/[[:space:]]*$//' "$file" > /tmp/temp_file && mv /tmp/temp_file "$file"
done
```

**2. Missing Final Newlines (C0304)**
```bash
# Add missing final newlines
for file in $(find src/openlit/instrumentation/{framework} -name "*.py"); do
    if [[ ! -s "$file" || $(tail -c1 "$file" | wc -l) -eq 0 ]]; then
        echo "" >> "$file"
    fi
done
```

**3. Line Too Long (C0301)**
```bash
# Find long lines for manual fixing
awk 'length($0) > 80 { print FILENAME ":" NR ":" length($0) ":" $0 }' src/openlit/instrumentation/{framework}/*.py
```

**Manual fixes for long lines:**
```python
# BAD: Long import
from openlit.instrumentation.framework.async_framework import async_general_wrap

# GOOD: Split import
from openlit.instrumentation.framework.async_framework import (
    async_general_wrap
)

# BAD: Long tuple
("very.long.module.name", "VeryLongClassName.very_long_method_name", "operation_type"),

# GOOD: Split tuple
("very.long.module.name", 
 "VeryLongClassName.very_long_method_name", "operation_type"),

# BAD: Long function call
wrap_function_wrapper(module, method, general_wrap(operation_type, version, environment, application_name, tracer, pricing_info, capture_message_content, metrics, disable_metrics))

# GOOD: Split function call
wrap_function_wrapper(
    module, method,
    general_wrap(operation_type, version, environment, application_name,
                tracer, pricing_info, capture_message_content,
                metrics, disable_metrics)
)
```

**4. Syntax Errors (E0001)**
```bash
# Test compilation to catch syntax errors
python3 -m py_compile src/openlit/instrumentation/{framework}/*.py
```

**5. Code Quality Issues**

**Unused Imports (W0611)**
```python
# BAD: Unused import
from typing import Dict, Any, Optional  # Optional not used

# GOOD: Remove unused
from typing import Dict, Any
```

**Consider Using 'in' (R1714)**
```python
# BAD: Multiple or comparisons
if endpoint == "query" or endpoint == "query_async":

# GOOD: Use 'in' operator
if endpoint in ("query", "query_async"):
```

**Too Many Nested Blocks (R1702)**
```python
# BAD: Deep nesting
if condition1:
    if condition2:
        if condition3:
            if condition4:
                if condition5:
                    # Too nested

# GOOD: Early returns or extraction
if not condition1:
    return
if not condition2:
    return
# Process main logic
```

### Step 7.3: Automated Cleanup Script

Create a cleanup script for consistent application:

```bash
#!/bin/bash
# cleanup_instrumentation.sh

FRAMEWORK_DIR="src/openlit/instrumentation/$1"

echo "🧹 Cleaning up $FRAMEWORK_DIR..."

# 1. Remove trailing whitespace
echo "  ✂️  Removing trailing whitespace..."
find "$FRAMEWORK_DIR" -name "*.py" -exec sed -i '' 's/[[:space:]]*$//' {} \;

# 2. Add missing final newlines
echo "  📝 Adding missing final newlines..."
find "$FRAMEWORK_DIR" -name "*.py" | while read file; do
    if [[ ! -s "$file" || $(tail -c1 "$file" | wc -l) -eq 0 ]]; then
        echo "" >> "$file"
    fi
done

# 3. Check for syntax errors
echo "  🔍 Checking syntax..."
for file in "$FRAMEWORK_DIR"/*.py; do
    if ! python3 -m py_compile "$file" 2>/dev/null; then
        echo "    ❌ Syntax error in $file"
    fi
done

# 4. Find long lines
echo "  📏 Checking line lengths..."
long_lines=$(find "$FRAMEWORK_DIR" -name "*.py" -exec awk 'length($0) > 80 { print FILENAME ":" NR ":" length($0) }' {} \; | wc -l)
if [ "$long_lines" -gt 0 ]; then
    echo "    ⚠️  Found $long_lines lines over 80 characters"
    find "$FRAMEWORK_DIR" -name "*.py" -exec awk 'length($0) > 80 { print FILENAME ":" NR ":" length($0) }' {} \;
fi

echo "✅ Cleanup complete!"
```

**Usage:**
```bash
chmod +x cleanup_instrumentation.sh
./cleanup_instrumentation.sh llamaindex
./cleanup_instrumentation.sh haystack
```

### Step 7.4: Final Validation

**Required Checks Before Commit:**
1. ✅ All files compile without syntax errors
2. ✅ No trailing whitespace
3. ✅ All files end with newline
4. ✅ No lines over 80 characters (or acceptable limit)
5. ✅ No unused imports
6. ✅ Code quality issues resolved

**Validation Commands:**
```bash
# Complete validation suite
python3 -m py_compile src/openlit/instrumentation/{framework}/*.py
grep -r " $" src/openlit/instrumentation/{framework}/ | wc -l  # Should be 0
find src/openlit/instrumentation/{framework} -name "*.py" -exec awk 'length($0) > 80' {} \; | wc -l  # Should be 0
pylint --disable=all --enable=line-too-long,trailing-whitespace,missing-final-newline,trailing-newlines,syntax-error,unused-import src/openlit/instrumentation/{framework}/
```

**Success Criteria:**
- Exit code 0 from py_compile (no syntax errors)
- 0 trailing whitespace instances
- 0 lines over length limit
- Clean pylint output for enabled checks 