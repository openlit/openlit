"""
Centralized configuration for OpenLIT CLI

This module defines all openlit.init() parameters and their corresponding
CLI arguments and environment variables in one place to ensure consistency.
"""

import inspect
import os
import openlit
from typing import Dict, Any, Tuple, Optional


def get_openlit_init_signature() -> Dict[str, Any]:
    """
    Get the signature of openlit.init() function to automatically
    extract parameter names, defaults, and types.
    """
    sig = inspect.signature(openlit.init)
    params = {}
    
    for name, param in sig.parameters.items():
        params[name] = {
            'default': param.default if param.default != inspect.Parameter.empty else None,
            'annotation': param.annotation if param.annotation != inspect.Parameter.empty else None,
        }
    
    return params


# Centralized parameter configuration
# Maps openlit.init() parameter names to their CLI and environment variable settings
PARAMETER_CONFIG = {
    'environment': {
        'env_var': 'OTEL_DEPLOYMENT_ENVIRONMENT',
        'cli_help': 'Deployment environment',
        'cli_type': str,
    },
    'application_name': {
        'env_var': 'OTEL_SERVICE_NAME', 
        'cli_help': 'Application name for tracing',
        'cli_type': str,
    },
    'otlp_endpoint': {
        'env_var': 'OTEL_EXPORTER_OTLP_ENDPOINT',
        'cli_help': 'OTLP endpoint for exporter',
        'cli_type': str,
    },
    'otlp_headers': {
        'env_var': 'OTEL_EXPORTER_OTLP_HEADERS',
        'cli_help': 'OTLP headers as JSON string',
        'cli_type': str,
        'parser': 'json',  # Special handling needed
    },
    'disable_batch': {
        'env_var': 'OPENLIT_DISABLE_BATCH',
        'cli_help': 'Disable batch span processing',
        'cli_type': bool,
    },
    'capture_message_content': {
        'env_var': 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
        'cli_help': 'Enable capture of message content',
        'cli_type': bool,
        'has_negation': True,  # Supports --no_capture_message_content
    },
    'disabled_instrumentors': {
        'env_var': 'OPENLIT_DISABLED_INSTRUMENTORS',
        'cli_help': 'Comma-separated list of instrumentors to disable',
        'cli_type': str,
        'parser': 'csv',  # Special handling needed
    },
    'disable_metrics': {
        'env_var': 'OPENLIT_DISABLE_METRICS',
        'cli_help': 'Disable metrics collection',
        'cli_type': bool,
    },
    'pricing_json': {
        'env_var': 'OPENLIT_PRICING_JSON',
        'cli_help': 'File path or URL to pricing JSON',
        'cli_type': str,
    },
    'collect_gpu_stats': {
        'env_var': 'OPENLIT_COLLECT_GPU_STATS',
        'cli_help': 'Enable GPU statistics collection',
        'cli_type': bool,
    },
    'detailed_tracing': {
        'env_var': 'OPENLIT_DETAILED_TRACING',
        'cli_help': 'Enable detailed component-level tracing',
        'cli_type': bool,
        'has_negation': True,  # Supports --no_detailed_tracing
    },
    
    # Parameters that are not exposed via CLI (internal use only)
    'tracer': {
        'internal': True,  # Skip in CLI
    },
    'event_logger': {
        'internal': True,  # Skip in CLI
    },
    'meter': {
        'internal': True,  # Skip in CLI
    },
}


def get_cli_parameters() -> Dict[str, Dict[str, Any]]:
    """Get parameters that should be exposed in the CLI."""
    return {
        name: config for name, config in PARAMETER_CONFIG.items()
        if not config.get('internal', False)
    }


def get_env_var_for_parameter(param_name: str) -> Optional[str]:
    """Get the environment variable name for a given parameter."""
    config = PARAMETER_CONFIG.get(param_name, {})
    return config.get('env_var')


def parse_env_value(param_name: str, env_value: str) -> Any:
    """Parse environment variable value based on parameter configuration."""
    config = PARAMETER_CONFIG.get(param_name, {})
    parser = config.get('parser')
    cli_type = config.get('cli_type', str)
    
    if cli_type == bool:
        return env_value.lower() in ('true', '1', 'yes')
    elif parser == 'json':
        try:
            import json
            return json.loads(env_value)
        except (json.JSONDecodeError, ImportError):
            return None
    elif parser == 'csv':
        return [item.strip() for item in env_value.split(',') if item.strip()]
    else:
        return env_value


def build_config_from_environment() -> Dict[str, Any]:
    """Build OpenLIT configuration from environment variables."""
    config = {}
    
    for param_name, param_config in PARAMETER_CONFIG.items():
        if param_config.get('internal', False):
            continue
            
        env_var = param_config.get('env_var')
        if not env_var:
            continue
            
        env_value = os.environ.get(env_var)
        if env_value:
            parsed_value = parse_env_value(param_name, env_value)
            if parsed_value is not None:
                config[param_name] = parsed_value
    
    return config


def validate_parameters():
    """
    Validate that PARAMETER_CONFIG is in sync with openlit.init() signature.
    This should be called during development/testing to catch mismatches.
    """
    init_params = get_openlit_init_signature()
    config_params = set(PARAMETER_CONFIG.keys())
    init_param_names = set(init_params.keys())
    
    # Check for parameters in init but not in config
    missing_in_config = init_param_names - config_params
    if missing_in_config:
        raise ValueError(f"Parameters in openlit.init() but not in PARAMETER_CONFIG: {missing_in_config}")
    
    # Check for parameters in config but not in init  
    extra_in_config = config_params - init_param_names
    if extra_in_config:
        raise ValueError(f"Parameters in PARAMETER_CONFIG but not in openlit.init(): {extra_in_config}")
    
    return True


if __name__ == "__main__":
    # Run validation when module is executed directly
    try:
        validate_parameters()
        print("✅ Parameter configuration is in sync with openlit.init()")
    except ValueError as e:
        print(f"❌ Parameter configuration validation failed: {e}")
        exit(1)