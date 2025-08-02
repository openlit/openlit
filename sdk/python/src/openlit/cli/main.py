#!/usr/bin/env python3
"""
OpenLIT Auto-Instrumentation CLI

This module provides a CLI tool for auto-instrumenting Python applications
with OpenLIT observability without requiring code changes.

Usage:
    openlit-instrument --application_name myapp --otlp_endpoint https://cloud.openlit.io python app.py
"""

import os
import sys
import argparse

from .config import get_cli_parameters, get_env_var_for_parameter, PARAMETER_CONFIG


def parse_arguments() -> tuple:
    """Parse command line arguments (target command only)."""
    # Build environment variables help text
    env_vars_help = []
    cli_params = get_cli_parameters()
    for param_name, config in cli_params.items():
        env_var = config.get('env_var', '')
        help_text = config.get('cli_help', '')
        env_vars_help.append(f"  {env_var:<50} {help_text}")
    
    parser = argparse.ArgumentParser(
        prog="openlit-instrument",
        description="Auto-instrument Python applications with OpenLIT observability",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
  # Set environment variables and run
  export OTEL_SERVICE_NAME="myapp"
  export OTEL_DEPLOYMENT_ENVIRONMENT="production"
  openlit-instrument python app.py
  
  # One-liner with environment variables
  OTEL_SERVICE_NAME=myapp OTEL_DEPLOYMENT_ENVIRONMENT=production openlit-instrument python app.py
  
  # Disable specific instrumentations
  OPENLIT_DISABLED_INSTRUMENTORS=chromadb,pinecone openlit-instrument python main.py

Environment Variables:
  Configure OpenLIT using these environment variables:
{chr(10).join(env_vars_help)}
        """
    )
    
    parser.add_argument(
        "--version", 
        action="version", 
        version="%(prog)s 1.0.0"
    )
    
    # Parse known args, leave rest for target application
    args, remaining = parser.parse_known_args()
    
    if not remaining:
        parser.error("No target command specified. Please provide the Python command to run.")
    
    return args, remaining


def setup_auto_instrumentation() -> None:
    """Enable auto-instrumentation."""
    # Enable auto-instrumentation
    os.environ['OPENLIT_AUTO_INSTRUMENT'] = 'true'


def setup_python_path() -> None:
    """Ensure OpenLIT auto-initialization is available."""
    # Get the directory containing this module
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Add the bootstrap directory to Python path
    bootstrap_path = os.path.join(current_dir, 'bootstrap')
    
    # Ensure the directory exists
    os.makedirs(bootstrap_path, exist_ok=True)
    
    # Prepend to PYTHONPATH to ensure it's loaded first
    current_pythonpath = os.environ.get('PYTHONPATH', '')
    if current_pythonpath:
        os.environ['PYTHONPATH'] = f"{bootstrap_path}:{current_pythonpath}"
    else:
        os.environ['PYTHONPATH'] = bootstrap_path


def show_configuration() -> None:
    """Show current OpenLIT configuration from environment variables (only if non-default values are set)."""
    # Only show configuration if non-default values are set
    config_items = [
        ("Service Name", "OTEL_SERVICE_NAME"),
        ("Environment", "OTEL_DEPLOYMENT_ENVIRONMENT"),
        ("OTLP Endpoint", "OTEL_EXPORTER_OTLP_ENDPOINT"),
        ("OTLP Headers", "OTEL_EXPORTER_OTLP_HEADERS"),
        ("Capture Content", "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"),
        ("Disabled Instrumentors", "OPENLIT_DISABLED_INSTRUMENTORS"),
        ("Disable Batch", "OPENLIT_DISABLE_BATCH"),
        ("Disable Metrics", "OPENLIT_DISABLE_METRICS"),
        ("Collect GPU Stats", "OPENLIT_COLLECT_GPU_STATS"),
        ("Detailed Tracing", "OPENLIT_DETAILED_TRACING"),
        ("Pricing JSON", "OPENLIT_PRICING_JSON"),
    ]
    
    # Check if any non-default values are set
    has_config = any(os.environ.get(env_var) for _, env_var in config_items)
    
    if has_config:
        print("🔧 OpenLIT Configuration:", file=sys.stderr)
        for label, env_var in config_items:
            value = os.environ.get(env_var)
            if value:
                print(f"   {label}: {value}", file=sys.stderr)
        print("", file=sys.stderr)  # Empty line for spacing


def run() -> None:
    """Main entry point for openlit-instrument CLI."""
    try:
        # Parse CLI arguments (just target command)
        args, target_command = parse_arguments()
        
        # Enable auto-instrumentation
        setup_auto_instrumentation()
        
        
        # Setup Python path for auto-initialization
        setup_python_path()
        
        
        # Execute target application with OpenLIT environment
        os.execvpe(target_command[0], target_command, os.environ)
        
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user", file=sys.stderr)
        sys.exit(130)
    except FileNotFoundError as e:
        print(f"❌ Command not found: {e}", file=sys.stderr)
        sys.exit(127)
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    run()