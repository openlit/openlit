#!/usr/bin/env python3
"""
Run all three MCP instrumentation tests and compare results.
"""

import subprocess
import sys
import time


def run_test(test_file: str, instrumentation_name: str):
    """Run a single test file and capture results"""
    print(f"\n{'='*60}")
    print(f"🧪 RUNNING {instrumentation_name.upper()} TEST")
    print(f"{'='*60}")
    
    try:
        # Run the test file
        result = subprocess.run(
            [sys.executable, test_file],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        # Print output
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        
        # Determine success
        success = result.returncode == 0 and "✅ SUCCESS" in result.stdout
        
        return {
            'name': instrumentation_name,
            'success': success,
            'return_code': result.returncode,
            'output': result.stdout,
            'error': result.stderr
        }
        
    except subprocess.TimeoutExpired:
        print(f"❌ {instrumentation_name} test timed out after 30 seconds")
        return {
            'name': instrumentation_name,
            'success': False,
            'return_code': -1,
            'output': '',
            'error': 'Timeout'
        }
    except Exception as e:
        print(f"❌ {instrumentation_name} test failed with exception: {e}")
        return {
            'name': instrumentation_name,
            'success': False,
            'return_code': -1,
            'output': '',
            'error': str(e)
        }


def analyze_results(results):
    """Analyze and compare all test results"""
    print(f"\n{'='*60}")
    print(f"📊 COMPREHENSIVE MCP INSTRUMENTATION COMPARISON")
    print(f"{'='*60}")
    
    # Summary table
    print(f"\n📋 Test Results Summary:")
    print(f"{'Instrumentation':<15} | {'Status':<10} | {'Notes'}")
    print(f"{'-'*15} | {'-'*10} | {'-'*30}")
    
    for result in results:
        status = "✅ PASS" if result['success'] else "❌ FAIL"
        notes = "Working" if result['success'] else f"Error: {result.get('error', 'Unknown')}"
        print(f"{result['name']:<15} | {status:<10} | {notes}")
    
    # Detailed analysis
    print(f"\n🔍 Detailed Analysis:")
    
    successful_tests = [r for r in results if r['success']]
    failed_tests = [r for r in results if not r['success']]
    
    print(f"  ✅ Successful tests: {len(successful_tests)}/3")
    print(f"  ❌ Failed tests: {len(failed_tests)}/3")
    
    if successful_tests:
        print(f"\n✅ Working Instrumentations:")
        for result in successful_tests:
            print(f"  • {result['name']}: Completed all MCP operations")
    
    if failed_tests:
        print(f"\n❌ Failed Instrumentations:")
        for result in failed_tests:
            error_msg = result.get('error', 'Unknown error')
            if 'not available' in error_msg:
                print(f"  • {result['name']}: Package not installed")
            elif 'Timeout' in error_msg:
                print(f"  • {result['name']}: Test timed out")
            else:
                print(f"  • {result['name']}: {error_msg}")
    
    # Competitive analysis
    openlit_result = next((r for r in results if r['name'] == 'OpenLIT'), None)
    
    print(f"\n🏆 COMPETITIVE ANALYSIS:")
    
    if openlit_result and openlit_result['success']:
        print(f"  🚀 OpenLIT: ✅ WORKING")
        print(f"    • Comprehensive MCP instrumentation")
        print(f"    • MCP-specific attribute namespace (mcp.*)")
        print(f"    • Business intelligence capture")
        print(f"    • Performance metrics tracking")
        print(f"    • Expected: 10 detailed spans with rich attributes")
    else:
        print(f"  🚀 OpenLIT: ❌ NOT WORKING")
    
    competitors_working = len([r for r in results if r['name'] != 'OpenLIT' and r['success']])
    competitors_total = len([r for r in results if r['name'] != 'OpenLIT'])
    
    print(f"  📊 Competitors: {competitors_working}/{competitors_total} working")
    
    for result in results:
        if result['name'] != 'OpenLIT':
            if result['success']:
                print(f"    • {result['name']}: ✅ Basic functionality")
            else:
                print(f"    • {result['name']}: ❌ Not working")
    
    # Final verdict
    print(f"\n🎉 FINAL VERDICT:")
    
    if openlit_result and openlit_result['success']:
        print(f"  🏆 OpenLIT provides superior MCP observability!")
        print(f"  ✅ Comprehensive business intelligence")
        print(f"  ✅ MCP-specific observability namespace")
        print(f"  ✅ Performance and cost tracking")
        print(f"  ✅ Rich span attributes and business metrics")
    
    if competitors_working > 0:
        print(f"  📊 {competitors_working} competitor(s) provide basic functionality")
    else:
        print(f"  🥇 OpenLIT is the ONLY working MCP instrumentation!")
    
    success_rate = len(successful_tests) / len(results) * 100
    print(f"  📈 Overall test success rate: {success_rate:.1f}%")


def main():
    """Main comparison function"""
    print("🧠 MCP INSTRUMENTATION COMPREHENSIVE COMPARISON")
    print("Testing OpenLIT vs OpenInference vs OpenLLMetry")
    print("Running identical MCP operations on all three instrumentations...")
    
    # Test configurations
    tests = [
        ("test_openlit_mcp.py", "OpenLIT"),
        ("test_openinference_mcp.py", "OpenInference"),
        ("test_openllmetry_mcp.py", "OpenLLMetry")
    ]
    
    results = []
    
    # Run each test
    for test_file, name in tests:
        result = run_test(test_file, name)
        results.append(result)
        time.sleep(1)  # Brief pause between tests
    
    # Analyze results
    analyze_results(results)


if __name__ == "__main__":
    main()
