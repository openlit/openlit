"""
Test script to reproduce Issue #971 - Qdrant instrumentation failure with qdrant-client >= 1.16.0
"""
import sys

print("=" * 60)
print("Testing Qdrant Instrumentation Issue #971")
print("=" * 60)

# Check qdrant-client version
try:
    import importlib.metadata
    qdrant_version = importlib.metadata.version("qdrant-client")
    print(f"✓ qdrant-client version: {qdrant_version}")
except Exception as e:
    print(f"✗ Cannot detect qdrant-client version: {e}")
    sys.exit(1)

# Check if deprecated methods exist
try:
    from qdrant_client import QdrantClient
    deprecated = ["search", "search_groups", "recommend"]
    new_methods = ["query_points", "query_points_groups", "query_batch_points"]
    
    print(f"\nDeprecated methods availability:")
    for method in deprecated:
        has_method = hasattr(QdrantClient, method)
        status = "✓" if has_method else "✗"
        print(f"  {status} {method}: {has_method}")
    
    print(f"\nNew methods availability:")
    for method in new_methods:
        has_method = hasattr(QdrantClient, method)
        status = "✓" if has_method else "✗"
        print(f"  {status} {method}: {has_method}")
    
except Exception as e:
    print(f"✗ Error checking QdrantClient methods: {e}")
    sys.exit(1)

# Try to initialize OpenLIT
print(f"\n{'=' * 60}")
print("Attempting to initialize OpenLIT instrumentation...")
print("=" * 60)

try:
    import openlit
    openlit.init(
        otlp_endpoint="http://localhost:4318",
        collect_gpu_stats=False,
        disable_batch=True
    )
    print("✓ OpenLIT instrumentation initialized successfully!")
    
except Exception as e:
    print(f"✗ OpenLIT instrumentation FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print(f"\n{'=' * 60}")
print("Test completed successfully!")
print("=" * 60)
