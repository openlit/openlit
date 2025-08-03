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
        env_var = config.get("env_var", "")
        help_text = config.get("cli_help", "")
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
        """,
    )

    # Dynamically add CLI arguments from PARAMETER_CONFIG
    cli_params = get_cli_parameters()
    for param_name, config in cli_params.items():
        cli_arg = f"--{param_name}"  # Use underscores like function parameters
        cli_help = (
            f"{config.get('cli_help', '')} (equivalent to {config.get('env_var', '')})"
        )
        cli_type = config.get("cli_type", str)

        if cli_type == bool:
            parser.add_argument(cli_arg, action="store_true", help=cli_help)
        else:
            parser.add_argument(cli_arg, help=cli_help)

    parser.add_argument("--version", action="version", version="%(prog)s 1.0.0")

    # Parse known args, leave rest for target application
    args, remaining = parser.parse_known_args()

    if not remaining:
        parser.error(
            "No target command specified. Please provide the Python command to run."
        )

    return args, remaining


def set_environment_from_cli_args(args) -> None:
    """Set environment variables from CLI arguments (only if env vars are not already set)."""
    # Dynamically map CLI arguments to environment variables from PARAMETER_CONFIG
    cli_params = get_cli_parameters()

    for param_name, config in cli_params.items():
        env_var = config.get("env_var")
        if not env_var:
            continue

        # Only set if environment variable is not already set (env vars take precedence)
        if env_var not in os.environ:
            cli_value = getattr(args, param_name, None)
            if cli_value is not None:
                # Handle boolean values
                if isinstance(cli_value, bool):
                    os.environ[env_var] = "true" if cli_value else "false"
                else:
                    os.environ[env_var] = str(cli_value)


def setup_auto_instrumentation() -> None:
    """Enable auto-instrumentation."""
    os.environ["OPENLIT_AUTO_INSTRUMENT"] = "true"


def setup_python_path() -> None:
    """Ensure OpenLIT auto-initialization is available."""
    # Get the directory containing this module
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # Add the bootstrap directory to Python path
    bootstrap_path = os.path.join(current_dir, "bootstrap")

    # Ensure the directory exists
    os.makedirs(bootstrap_path, exist_ok=True)

    # Prepend to PYTHONPATH to ensure it's loaded first
    current_pythonpath = os.environ.get("PYTHONPATH", "")
    if current_pythonpath:
        os.environ["PYTHONPATH"] = f"{bootstrap_path}:{current_pythonpath}"
    else:
        os.environ["PYTHONPATH"] = bootstrap_path


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
        sys.exit(130)
    except FileNotFoundError:
        sys.exit(127)
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    run()
