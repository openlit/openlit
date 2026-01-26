# Setup Instructions for Testing Issue #971

## Prerequisites

You need:
- Python 3.9+ installed
- pip or poetry package manager

## Setup Steps

### 1. Install qdrant-client >= 1.16.0 (to reproduce the bug)

```bash
pip install "qdrant-client>=1.16.0"
```

### 2. Install OpenLIT in development mode

```bash
cd sdk/python
pip install -e .
```

Or with poetry:

```bash
cd sdk/python
poetry install
```

### 3. Run the test script

```bash
# From repository root
python examples/test_qdrant_compatibility.py
```

## Expected Behavior

**With qdrant-client >= 1.16.0 (BEFORE fix):**
- The test should FAIL with an error about missing methods (search, search_groups, recommend)
- Debug logs may be written to local debug files (if instrumented)

**With the fix (AFTER applying changes):**
- The test should PASS
- OpenLIT should successfully instrument the available Qdrant methods
- Deprecated methods should be skipped gracefully

## Debug Log Location

Debug logs (if instrumented) are written to the local workspace debug file.

## What the test does

1. Checks qdrant-client version
2. Verifies which Qdrant methods exist (deprecated vs new)
3. Initializes OpenLIT instrumentation
4. Reports success or failure

The instrumentation code has been modified to log:
- Which methods it attempts to wrap
- Which methods succeed/fail
- Version information
- Method availability status
