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
    """Parse command line arguments and return parsed args and target command."""
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
  # Using CLI arguments
  openlit-instrument --service-name myapp --deployment-environment production python app.py
  
  # Using environment variables (takes precedence over CLI args)
  OTEL_SERVICE_NAME=myapp OTEL_DEPLOYMENT_ENVIRONMENT=production openlit-instrument python app.py
  
  # Mixed usage
  openlit-instrument --otlp-endpoint https://cloud.openlit.io python app.py
  
  # Disable specific instrumentations
  openlit-instrument --disabled-instrumentors chromadb,pinecone python main.py

Environment Variables (take precedence over CLI arguments):
  Configure OpenLIT using these environment variables:
{chr(10).join(env_vars_help)}
        """
    )
    
    # Add common CLI arguments that match OpenTelemetry patterns
    parser.add_argument(
        "--service-name",
        help="Service name for tracing (equivalent to OTEL_SERVICE_NAME)"
    )
    
    parser.add_argument(
        "--deployment-environment", 
        help="Deployment environment (equivalent to OTEL_DEPLOYMENT_ENVIRONMENT)"
    )
    
    parser.add_argument(
        "--otlp-endpoint",
        help="OTLP endpoint URL (equivalent to OTEL_EXPORTER_OTLP_ENDPOINT)"
    )
    
    parser.add_argument(
        "--otlp-headers",
        help="OTLP headers as JSON string (equivalent to OTEL_EXPORTER_OTLP_HEADERS)"
    )
    
    parser.add_argument(
        "--disabled-instrumentors",
        help="Comma-separated list of instrumentors to disable (equivalent to OPENLIT_DISABLED_INSTRUMENTORS)"
    )
    
    parser.add_argument(
        "--disable-batch",
        action="store_true",
        help="Disable batch span processing (equivalent to OPENLIT_DISABLE_BATCH=true)"
    )
    
    parser.add_argument(
        "--disable-metrics",
        action="store_true", 
        help="Disable metrics collection (equivalent to OPENLIT_DISABLE_METRICS=true)"
    )
    
    parser.add_argument(
        "--collect-gpu-stats",
        action="store_true",
        help="Enable GPU statistics collection (equivalent to OPENLIT_COLLECT_GPU_STATS=true)"
    )
    
    parser.add_argument(
        "--detailed-tracing",
        action="store_true",
        help="Enable detailed component-level tracing (equivalent to OPENLIT_DETAILED_TRACING=true)"
    )
    
    parser.add_argument(
        "--capture-message-content",
        action="store_true",
        help="Enable capture of message content (equivalent to OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true)"
    )
    
    parser.add_argument(
        "--pricing-json",
        help="File path or URL to pricing JSON (equivalent to OPENLIT_PRICING_JSON)"
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


def set_environment_from_cli_args(args) -> None:
    """Set environment variables from CLI arguments (only if env vars are not already set)."""
    # Mapping from CLI argument names to environment variable names
    cli_to_env_mapping = {
        'service_name': 'OTEL_SERVICE_NAME',
        'deployment_environment': 'OTEL_DEPLOYMENT_ENVIRONMENT', 
        'otlp_endpoint': 'OTEL_EXPORTER_OTLP_ENDPOINT',
        'otlp_headers': 'OTEL_EXPORTER_OTLP_HEADERS',
        'disabled_instrumentors': 'OPENLIT_DISABLED_INSTRUMENTORS',
        'disable_batch': 'OPENLIT_DISABLE_BATCH',
        'disable_metrics': 'OPENLIT_DISABLE_METRICS',
        'collect_gpu_stats': 'OPENLIT_COLLECT_GPU_STATS',
        'detailed_tracing': 'OPENLIT_DETAILED_TRACING',
        'capture_message_content': 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
        'pricing_json': 'OPENLIT_PRICING_JSON',
    }
    
    for cli_arg, env_var in cli_to_env_mapping.items():
        # Only set if environment variable is not already set (env vars take precedence)
        if env_var not in os.environ:
            cli_value = getattr(args, cli_arg, None)
            if cli_value is not None:
                # Handle boolean values
                if isinstance(cli_value, bool):
                    os.environ[env_var] = 'true' if cli_value else 'false'
                else:
                    os.environ[env_var] = str(cli_value)


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
        # Parse CLI arguments and target command
        args, target_command = parse_arguments()
        
        # Set environment variables from CLI arguments (env vars take precedence)
        set_environment_from_cli_args(args)
        
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