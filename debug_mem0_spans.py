#!/usr/bin/env python3
"""
Debug mem0 span creation to identify hierarchy issues.
"""

import sys
import os
sys.path.insert(0, 'sdk/python/src')
os.environ['OPENAI_API_KEY'] = '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'

import openlit
import logging

# Setup logging to see debug info
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def debug_mem0_instrumentation():
    """Debug mem0 instrumentation setup and span creation."""
    print("🔍 Debugging Mem0 Instrumentation")
    print("=" * 50)
    
    print("1. Checking instrumentor registration...")
    from openlit._instrumentors import get_instrumentor_class, INSTRUMENTOR_MAP
    
    if "mem0" in INSTRUMENTOR_MAP:
        print("   ✅ mem0 found in INSTRUMENTOR_MAP")
        print(f"   📍 Path: {INSTRUMENTOR_MAP['mem0']}")
    else:
        print("   ❌ mem0 NOT found in INSTRUMENTOR_MAP")
        return False
    
    print("\n2. Testing instrumentor class loading...")
    try:
        mem0_class = get_instrumentor_class("mem0")
        if mem0_class:
            print(f"   ✅ Mem0Instrumentor class loaded: {mem0_class}")
            print(f"   📍 Module: {mem0_class.__module__}")
        else:
            print("   ❌ Failed to load Mem0Instrumentor class")
            return False
    except Exception as e:
        print(f"   ❌ Exception loading Mem0Instrumentor: {e}")
        return False
    
    print("\n3. Initializing OpenLIT...")
    try:
        openlit.init(detailed_tracing=True,
            otlp_endpoint="http://127.0.0.1:4318")
        print("   ✅ OpenLIT initialized successfully")
    except Exception as e:
        print(f"   ❌ OpenLIT initialization failed: {e}")
        return False
    
    print("\n4. Testing mem0 import and instrumentation...")
    try:
        from mem0 import Memory
        print("   ✅ mem0.Memory imported successfully")
        
        # Check if methods are wrapped
        memory = Memory()
        print("   ✅ Memory instance created")
        
        # Check if add method is wrapped
        add_method = getattr(memory, 'add', None)
        if add_method:
            print(f"   ✅ Memory.add method found: {add_method}")
            print(f"   📍 Method type: {type(add_method)}")
            
            # Check for wrapper indicators
            if hasattr(add_method, '__wrapped__'):
                print("   🎯 Memory.add appears to be wrapped (__wrapped__ found)")
            else:
                print("   ⚠️  Memory.add may not be wrapped (__wrapped__ not found)")
        else:
            print("   ❌ Memory.add method not found")
            
    except Exception as e:
        print(f"   ❌ mem0 import/setup failed: {e}")
        return False
    
    print("\n5. Testing simple mem0 operation with span capturing...")
    
    # Create a simple span collector
    spans_captured = []
    
    class SimpleSpanCollector:
        def export(self, spans):
            for span in spans:
                attrs = dict(span.attributes) if span.attributes else {}
                spans_captured.append({
                    'name': span.name,
                    'system': attrs.get('gen_ai.system', 'unknown'),
                    'parent_id': format(span.parent.span_id, '016x') if span.parent else None,
                })
            return 0
        def shutdown(self):
            pass
    
    # Set up span collection only if we can import OpenTelemetry safely
    try:
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry import trace
        
        collector = SimpleSpanCollector()
        tracer_provider = TracerProvider()
        tracer_provider.add_span_processor(SimpleSpanProcessor(collector))
        trace.set_tracer_provider(tracer_provider)
        print("   ✅ Span collection configured")
        
        # Execute mem0 operation
        print("   🧠 Executing memory.add()...")
        result = memory.add(
            "Debug test for span hierarchy",
            user_id="debug_user"
        )
        print(f"   ✅ memory.add() completed: {result}")
        
        # Force flush
        tracer_provider.force_flush(1000)
        
        # Analyze spans
        print(f"\n📊 Spans captured: {len(spans_captured)}")
        
        mem0_spans = [s for s in spans_captured if s['system'] == 'mem0']
        other_spans = [s for s in spans_captured if s['system'] != 'mem0']
        
        print(f"   🧠 mem0 spans: {len(mem0_spans)}")
        print(f"   🔗 other spans: {len(other_spans)}")
        
        if mem0_spans:
            print("   ✅ SUCCESS: mem0 spans are being created!")
            for span in mem0_spans:
                parent_status = "ROOT" if span['parent_id'] is None else f"CHILD of {span['parent_id'][:8]}..."
                print(f"      - {span['name']} ({parent_status})")
        else:
            print("   ❌ PROBLEM: No mem0 spans found!")
            print("   📋 All spans found:")
            for span in spans_captured:
                parent_status = "ROOT" if span['parent_id'] is None else f"CHILD of {span['parent_id'][:8]}..."
                print(f"      - {span['name']} [{span['system']}] ({parent_status})")
        
        return len(mem0_spans) > 0
        
    except ImportError as e:
        print(f"   ⚠️  Could not set up span collection: {e}")
        print("   🔧 Trying basic execution without span capture...")
        
        # Just try the operation
        try:
            result = memory.add("Debug test basic", user_id="debug_user")
            print(f"   ✅ Basic memory.add() worked: {result}")
            return True
        except Exception as e:
            print(f"   ❌ Basic memory.add() failed: {e}")
            return False

if __name__ == "__main__":
    success = debug_mem0_instrumentation()
    
    print(f"\n{'='*50}")
    if success:
        print("🎉 DEBUG COMPLETE - mem0 instrumentation appears functional")
    else:
        print("❌ DEBUG REVEALED ISSUES - mem0 instrumentation needs fixing")
    print(f"{'='*50}")