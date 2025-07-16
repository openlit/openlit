# Framework Instrumentation Guide for OpenLIT

This guide provides a comprehensive, step-by-step process for adding new framework instrumentations or updating existing ones in OpenLIT. It's based on lessons learned from successful instrumentations including OpenAI Agents, Haystack, and others, ensuring consistency, performance, and competitive advantages across all framework integrations.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Competitive Analysis](#phase-1-competitive-analysis)
3. [Phase 2: Framework Analysis](#phase-2-framework-analysis)
4. [Phase 3: Implementation Strategy](#phase-3-implementation-strategy)
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

**CRITICAL**: Always use local OpenLIT source code for testing:
```bash
# DON'T install OpenLIT - use local source
PYTHONPATH=sdk/python/src python your_test_script.py
```

## Phase 1: Competitive Analysis

### Step 1.1: Clone and Research Competitor Implementations

**Primary Competitors:**
- [OpenInference](https://github.com/Arize-ai/openinference/tree/main/python/instrumentation)
- [OpenLLMetry](https://github.com/traceloop/openllmetry/tree/main/packages)

**Research Process:**
```bash
# Clone competitor repositories for deep analysis
git clone https://github.com/Arize-ai/openinference.git
git clone https://github.com/traceloop/openllmetry.git

# Navigate to framework-specific instrumentations
cd openinference/python/instrumentation/openinference-instrumentation-{framework}
cd openllmetry/packages/openllmetry-instrumentation-{framework}
```

**Deep Analysis Checklist:**
- [ ] **Integration Pattern**: Function wrapping vs native integration (like TracingProcessor)
- [ ] **Span Structure**: How many spans do they create and why?
- [ ] **Span Hierarchy**: Do they maintain proper parent-child relationships?
- [ ] **Span Naming**: What naming convention do they use?
- [ ] **Attributes**: What attributes do they capture? Check against semantic conventions
- [ ] **Content Capture**: Do they capture input/output content with MIME types?
- [ ] **Business Intelligence**: Do they track cost, tokens, performance metrics?
- [ ] **Error Handling**: How do they handle framework version differences?
- [ ] **Performance**: How much overhead do they add?
- [ ] **Coverage**: Which framework operations do they instrument?

### Step 1.2: Document Competitive Gaps and OpenLIT Advantages

Create detailed comparison:

| Feature | OpenInference | OpenLLMetry | OpenLIT Target |
|---------|---------------|-------------|----------------|
| Integration Method | Function wrapping | Function wrapping | Native (if available) |
| Span Count | X spans | Y spans | Z+ spans (comprehensive) |
| Business Intelligence | None/Basic | None/Basic | **Complete** (cost, tokens, metrics) |
| Content Capture | Basic | Basic | **Enhanced** (MIME types, structured) |
| Cross-System Tracing | Limited | Limited | **Full** (links to LLM providers) |
| Error Resilience | Basic | Basic | **Robust** (graceful degradation) |
| Semantic Conventions | Standard | Standard | **Extended** (custom attributes) |

**Key Insight**: OpenLIT's competitive advantage is **business intelligence** and **enhanced observability**.

## Phase 2: Framework Analysis

### Step 2.1: Explore Framework's Built-in Capabilities

**CRITICAL**: Before implementing, check if the framework has built-in tracing/monitoring:

```python
# Example: Discover OpenAI Agents has native tracing
import {framework}

# Look for tracing, monitoring, observability features
# Check documentation for:
# - Built-in tracing systems
# - Processor patterns  
# - Event hooks
# - Monitoring callbacks

# Example: OpenAI Agents has TracingProcessor
from agents import TracingProcessor, set_trace_processors
```

**Framework Integration Decision Tree:**
1. **Native Integration Available** (e.g., OpenAI Agents TracingProcessor)
   - ✅ Use native integration for perfect hierarchy
   - ✅ Extends framework's built-in system
   - ✅ Better performance and reliability

2. **Function Wrapping Required** (most frameworks)
   - ✅ Standard approach for frameworks without native tracing
   - ⚠️ Requires careful hierarchy management

### Step 2.2: Map Framework Operations

**Workflow vs Component Operations:**
```python
# Example for any framework
WORKFLOW_OPERATIONS = [
    # High-level operations users care about in production
    "agent.run_sync",     # OpenAI Agents
    "pipeline.run",       # Haystack  
    "workflow.execute"    # Generic
]

COMPONENT_OPERATIONS = [
    # Detailed operations for debugging (detailed_tracing=True)
    "retriever.retrieve",
    "generator.generate", 
    "embedder.embed",
    "tool.call"
]
```

### Step 2.3: Test Framework Methods and Patterns

**Method Discovery Script:**
```python
# test_framework_exploration.py
import {framework}

# Discover available methods and attributes
obj = SomeFrameworkClass()
print("Available methods:", [m for m in dir(obj) if not m.startswith('_')])

# Test built-in monitoring
if hasattr(obj, 'trace') or hasattr(obj, 'monitor'):
    print("Built-in tracing available!")
    
# Check for callback patterns
if hasattr(obj, 'add_callback') or hasattr(obj, 'on_event'):
    print("Event system available!")
```

## Phase 3: Implementation Strategy

### Step 3.1: Choose Integration Pattern

**Pattern 1: Native Integration (Preferred when available)**
```python
# Example: OpenAI Agents TracingProcessor
class OpenLITTracingProcessor(TracingProcessor):
    def on_trace_start(self, trace): pass
    def on_span_start(self, span): pass  
    def on_span_end(self, span): pass
```

**Pattern 2: Function Wrapping (Standard)**
```python
# Traditional OpenLIT pattern
wrap_function_wrapper("module", "Class.method", wrapper)
```

### Step 3.2: Plan Span Naming Convention

**CRITICAL**: Follow consistent naming pattern:
```python
# Standard format: "{operation_type} {operation_name}"
"agent Triage agent"      # operation_type=agent, operation_name=Triage agent
"chat gpt-4o"            # operation_type=chat, operation_name=gpt-4o  
"retrieve documents"      # operation_type=retrieve, operation_name=documents
"generate response"       # operation_type=generate, operation_name=response
```

### Step 3.3: Plan Semantic Conventions Usage

**Extend semcov.py when needed:**
```python
# It's OK to add new semantic conventions for better attributes
class SemanticConvention:
    # Add framework-specific conventions
    GEN_AI_AGENT_DESCRIPTION = "gen_ai.agent.description"
    GEN_AI_AGENT_VERSION = "gen_ai.agent.version"
    GEN_AI_WORKFLOW_TYPE = "gen_ai.workflow.type"
```

## Phase 4: Code Implementation

### Step 4.1: Create Test Infrastructure First

**Create span hierarchy test before implementing:**
```python
# test_span_hierarchy.py - Always create this first
import sys
sys.path.insert(0, 'sdk/python/src')  # Use local source

import openlit
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

class CollectingSpanExporter:
    def __init__(self):
        self.spans = []
    
    def export(self, spans):
        for span in spans:
            self.spans.append({
                'name': span.name,
                'parent_id': format(span.parent.span_id, '016x') if span.parent else None,
                'attributes': dict(span.attributes) if span.attributes else {}
            })
        return 0

def print_span_hierarchy(spans):
    """Print spans in hierarchical tree structure"""
    # Build parent-child relationships
    root_spans = [s for s in spans if s['parent_id'] is None]
    child_map = {}
    for span in spans:
        if span['parent_id']:
            child_map.setdefault(span['parent_id'], []).append(span)
    
    def print_span(span, level=0):
        indent = "  " * level
        prefix = "├── " if level > 0 else ""
        print(f"{indent}{prefix}{span['name']}")
        
        span_id = format(int(span['parent_id'] or 0), '016x')
        for child in child_map.get(span_id, []):
            print_span(child, level + 1)
    
    for root in root_spans:
        print_span(root)

def test_framework():
    collector = CollectingSpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(collector))
    
    openlit.init(detailed_tracing=True)
    
    # Test framework operations here
    # ...
    
    print_span_hierarchy(collector.spans)
```

### Step 4.2: Implement Based on Integration Pattern

**For Native Integration:**
```python
# processor.py - When framework has built-in tracing
class OpenLITTracingProcessor(FrameworkProcessor):
    def on_span_start(self, span):
        # Create OpenTelemetry span with proper naming
        span_name = self._get_span_name(span)  # {operation_type} {operation_name}
        otel_span = self._tracer.start_span(span_name, kind=SpanKind.CLIENT)
        
        # Set semantic convention attributes
        self._set_common_attributes(otel_span, span)
        
    def _get_span_name(self, span):
        operation_type = self._get_operation_type(span.span_data)
        operation_name = self._extract_operation_name(span.span_data)
        return f"{operation_type} {operation_name}"
```

**For Function Wrapping:**
```python
# Follow existing 4-file structure
# __init__.py, sync_wrapper.py, async_wrapper.py, utils.py
```

### Step 4.3: Implement Comprehensive Attributes

**Use semantic conventions extensively:**
```python
def _set_span_attributes(self, span, data):
    # Standard framework attributes
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, "framework_name")
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION_NAME, operation_name)
    
    # Model information (critical for business intelligence)
    model = self._extract_model_info(data)
    if model:
        span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model)
    
    # Content capture with MIME types (OpenLIT enhancement)
    if self._capture_message_content:
        self._capture_input_output_with_mime_types(span, data)
    
    # Business intelligence attributes
    self._capture_token_usage(span, data)
    self._capture_cost_metrics(span, data)
    
    # Framework-specific attributes
    if hasattr(data, 'agent_name'):
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, data.agent_name)
```

## Phase 5: Testing & Validation

### Step 5.1: Create Comprehensive Test Suite

**Test Categories:**
1. **Span Hierarchy Test** (most important)
2. **Competitive Comparison Test**
3. **Mock Framework Test** (when real framework unavailable)
4. **Error Resilience Test**

**Span Hierarchy Validation:**
```python
def test_span_hierarchy():
    """Validate proper parent-child relationships and span naming"""
    spans = run_instrumentation_test()
    
    # Validate hierarchy structure
    assert len(spans) > 0, "Must generate spans"
    
    # Check root span exists
    root_spans = [s for s in spans if s['parent_id'] is None]
    assert len(root_spans) == 1, "Must have exactly one root span"
    
    # Validate span naming convention
    for span in spans:
        assert ' ' in span['name'], f"Span name '{span['name']}' should follow '{{operation_type}} {{operation_name}}' format"
    
    # Check semantic conventions
    for span in spans:
        attrs = span['attributes']
        assert 'gen_ai.system' in attrs, "Must have gen_ai.system attribute"
```

### Step 5.2: Competitive Validation

**Critical Test - OpenLIT vs Competitors:**
```python
def test_competitive_superiority():
    """Validate OpenLIT generates more/better spans than competitors"""
    
    # Test OpenLIT
    openlit_spans = test_openlit_instrumentation()
    
    # Test competitors (with error handling)
    try:
        competitor1_spans = test_competitor_instrumentation("openinference")
        competitor2_spans = test_competitor_instrumentation("openllmetry")
    except Exception as e:
        print(f"Competitor failed: {e}")
        competitor1_spans = competitor2_spans = 0
    
    # Validate OpenLIT superiority
    assert openlit_spans > 0, "OpenLIT must generate spans"
    print(f"OpenLIT: {openlit_spans} spans (with business intelligence)")
    print(f"Competitor 1: {competitor1_spans} spans") 
    print(f"Competitor 2: {competitor2_spans} spans")
    
    # OpenLIT should provide comprehensive coverage
    assert openlit_spans >= max(competitor1_spans, competitor2_spans)
```

### Step 5.3: Mock Testing When Framework Unavailable

**Create realistic mock scenarios:**
```python
def test_with_mocks():
    """Test instrumentation when real framework isn't available"""
    tracer = trace.get_tracer(__name__)
    
    # Create realistic span hierarchy manually
    with tracer.start_as_current_span("agent Agent workflow") as root:
        root.set_attribute("gen_ai.agent.name", "Agent workflow")
        
        with tracer.start_as_current_span("agent Triage agent") as agent:
            agent.set_attribute("gen_ai.agent.name", "Triage agent")
            
            with tracer.start_as_current_span("chat gpt-4o") as chat:
                chat.set_attribute("gen_ai.request.model", "gpt-4o")
```

## Phase 6: Optimization

### Step 6.1: Performance Validation

**Measure instrumentation overhead:**
```python
def benchmark_performance():
    """Measure instrumentation performance impact"""
    import time
    
    # Test without instrumentation
    start = time.time()
    run_framework_operations(count=100)
    baseline = time.time() - start
    
    # Test with instrumentation
    openlit.init()
    start = time.time()
    run_framework_operations(count=100)
    instrumented = time.time() - start
    
    overhead = ((instrumented - baseline) / baseline) * 100
    print(f"Instrumentation overhead: {overhead:.2f}%")
    assert overhead < 10, "Overhead should be under 10%"
```

### Step 6.2: Business Intelligence Validation

**Verify OpenLIT's competitive advantages:**
```python
def test_business_intelligence():
    """Validate comprehensive business metrics capture"""
    spans = run_instrumentation_test()
    
    business_attributes = [
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
        'gen_ai.client.operation.duration',
        'gen_ai.request.model'
    ]
    
    for span in spans:
        attrs = span['attributes']
        found_attrs = [attr for attr in business_attributes if attr in attrs]
        print(f"Span '{span['name']}': {len(found_attrs)}/{len(business_attributes)} business attributes")
```

## Phase 7: Post-Change Cleanup

**CRITICAL**: Always run comprehensive cleanup after implementation:

### Step 7.1: Automated Code Quality Check

```bash
#!/bin/bash
# cleanup_instrumentation.sh
FRAMEWORK_DIR="src/openlit/instrumentation/$1"

echo "🧹 Cleaning up $FRAMEWORK_DIR..."

# Remove trailing whitespace
find "$FRAMEWORK_DIR" -name "*.py" -exec sed -i '' 's/[[:space:]]*$//' {} \;

# Add missing final newlines
find "$FRAMEWORK_DIR" -name "*.py" | while read file; do
    if [[ ! -s "$file" || $(tail -c1 "$file" | wc -l) -eq 0 ]]; then
        echo "" >> "$file"
    fi
done

# Check syntax
for file in "$FRAMEWORK_DIR"/*.py; do
    python3 -m py_compile "$file" || echo "❌ Syntax error in $file"
done

# Check line lengths
long_lines=$(find "$FRAMEWORK_DIR" -name "*.py" -exec awk 'length($0) > 80' {} \; | wc -l)
echo "Lines over 80 characters: $long_lines"
```

### Step 7.2: Final Validation Checklist

**Before committing:**
- [ ] All files compile without syntax errors
- [ ] No trailing whitespace
- [ ] Consistent span naming: `{operation_type} {operation_name}`
- [ ] Semantic conventions used extensively
- [ ] Business intelligence attributes captured
- [ ] Competitive validation passed
- [ ] Performance overhead acceptable (<10%)
- [ ] Proper error handling for missing components

## Code Standards & Patterns

### Span Naming Convention

**MANDATORY Format**: `{operation_type} {operation_name}`

```python
# ✅ CORRECT
"agent Triage agent"
"chat gpt-4o"
"retrieve documents"
"generate response"
"workflow multi-agent"

# ❌ INCORRECT  
"Triage agent"           # Missing operation type
"agent_execution"        # Wrong format
"chat_completion_gpt4"   # Wrong format
```

### Semantic Conventions Usage

**Extensive usage required - add to semcov.py when needed:**

```python
# Always use semantic conventions
span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, "framework_name")
span.set_attribute(SemanticConvention.GEN_AI_OPERATION_NAME, operation_name)
span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model)

# Add new conventions when needed
class SemanticConvention:
    GEN_AI_AGENT_DESCRIPTION = "gen_ai.agent.description"
    GEN_AI_WORKFLOW_TYPE = "gen_ai.workflow.type"
```

### Business Intelligence Attributes

**Always capture OpenLIT's competitive advantages:**

```python
# Token usage and cost tracking
span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration)

# Content capture with MIME types
span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, content)
span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, response)
```

## Quality Checklist

### Phase Completion Checklist

**Phase 1 - Competitive Analysis:**
- [ ] Competitor repositories cloned and analyzed
- [ ] Integration patterns documented
- [ ] Competitive gaps identified
- [ ] OpenLIT advantages planned

**Phase 2 - Framework Analysis:**
- [ ] Built-in capabilities explored
- [ ] Method discovery completed
- [ ] Integration pattern chosen
- [ ] Operation mapping defined

**Phase 3 - Implementation Strategy:**
- [ ] Span naming convention defined
- [ ] Semantic conventions planned
- [ ] Test infrastructure designed

**Phase 4 - Implementation:**
- [ ] Test script created first
- [ ] Integration pattern implemented
- [ ] Semantic conventions used extensively
- [ ] Business intelligence captured

**Phase 5 - Testing:**
- [ ] Span hierarchy validated
- [ ] Competitive comparison passed
- [ ] Mock testing completed
- [ ] Error resilience tested

**Phase 6 - Optimization:**
- [ ] Performance overhead measured (<10%)
- [ ] Business intelligence validated
- [ ] Competitive advantages confirmed

**Phase 7 - Cleanup:**
- [ ] Code quality checks passed
- [ ] Syntax errors resolved
- [ ] Line length compliant
- [ ] Final validation completed

### Success Criteria

**Instrumentation is complete when:**
1. ✅ Generates more/better spans than competitors
2. ✅ Follows `{operation_type} {operation_name}` naming
3. ✅ Uses semantic conventions extensively
4. ✅ Captures comprehensive business intelligence
5. ✅ Maintains proper span hierarchy
6. ✅ Performance overhead <10%
7. ✅ Handles errors gracefully
8. ✅ Code quality standards met

**OpenLIT Competitive Advantages Delivered:**
- 🎯 **Business Intelligence**: Cost tracking, token usage, performance metrics
- 🔗 **Cross-System Integration**: Links to LLM provider spans
- 🎨 **Enhanced Observability**: MIME types, structured content capture
- 🛡️ **Error Resilience**: Graceful degradation across framework versions
- 📊 **Comprehensive Coverage**: More spans and attributes than competitors 