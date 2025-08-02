#!/usr/bin/env python3
"""
Debug script to test OpenLIT CLI step by step
"""

import sys
import os

# Add the SDK path
sys.path.insert(0, 'sdk/python/src')

print("🔍 Debug OpenLIT CLI")
print(f"📍 Python path: {sys.path}")
print(f"📍 Current directory: {os.getcwd()}")

# Test 1: Can we import the CLI?
try:
    from openlit.cli.main import parse_arguments, set_environment_variables
    print("✅ CLI imports successful")
except ImportError as e:
    print(f"❌ CLI import failed: {e}")
    sys.exit(1)

# Test 2: Parse some sample arguments
try:
    # Simulate CLI arguments
    test_args = ['openlit-instrument', '--application_name', 'debug-test', '--environment', 'development', 'python', 'test.py']
    sys.argv = test_args
    
    args, remaining = parse_arguments()
    print("✅ Argument parsing successful")
    print(f"   Application: {args.application_name}")
    print(f"   Environment: {args.environment}")
    print(f"   Remaining: {remaining}")
    
    # Test 3: Set environment variables
    set_environment_variables(args)
    print("✅ Environment variables set")
    print(f"   OTEL_SERVICE_NAME: {os.environ.get('OTEL_SERVICE_NAME', 'NOT SET')}")
    print(f"   OTEL_DEPLOYMENT_ENVIRONMENT: {os.environ.get('OTEL_DEPLOYMENT_ENVIRONMENT', 'NOT SET')}")
    print(f"   OPENLIT_AUTO_INSTRUMENT: {os.environ.get('OPENLIT_AUTO_INSTRUMENT', 'NOT SET')}")
    
except Exception as e:
    print(f"❌ CLI processing failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 4: Can we import OpenLIT?
try:
    import openlit
    print("✅ OpenLIT import successful")
    
    # Test 5: Try manual initialization
    openlit.init(
        application_name=args.application_name,
        environment=args.environment
    )
    print("✅ OpenLIT manual initialization successful")
    
except Exception as e:
    print(f"❌ OpenLIT initialization failed: {e}")
    import traceback
    traceback.print_exc()

print("\n🧪 Now testing OpenAI call with instrumentation...")

# Test 6: Try OpenAI call
try:
    from openai import OpenAI
    
    client = OpenAI(
        api_key="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"
    )
    
    print("🚀 Making OpenAI call...")
    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": "Hello from OpenLIT CLI debug!"}],
        model="gpt-3.5-turbo",
    )
    
    print(f"✅ OpenAI call successful: {chat_completion.choices[0].message.content[:100]}...")
    
except Exception as e:
    print(f"❌ OpenAI call failed: {e}")
    import traceback
    traceback.print_exc()

print("\n🎯 Debug complete!")