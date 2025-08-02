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


# Centralized parameter configuration - SINGLE SOURCE OF TRUTH
# Add new parameters here ONLY - they will automatically appear in both CLI and openlit.init()
PARAMETER_CONFIG = {
    'environment': {
        'default': 'default',
        'env_var': 'OTEL_DEPLOYMENT_ENVIRONMENT',
        'cli_help': 'Deployment environment',
        'cli_type': str,
    },
    'application_name': {
        'default': 'default',
        'env_var': 'OTEL_SERVICE_NAME', 
        'cli_help': 'Application name for tracing',
        'cli_type': str,
        # CLI argument will be --application_name (matching function parameter)
    },
    'otlp_endpoint': {
        'default': None,
        'env_var': 'OTEL_EXPORTER_OTLP_ENDPOINT',
        'cli_help': 'OTLP endpoint for exporter',
        'cli_type': str,
    },
    'otlp_headers': {
        'default': None,
        'env_var': 'OTEL_EXPORTER_OTLP_HEADERS',
        'cli_help': 'OTLP headers as JSON string',
        'cli_type': str,
        'parser': 'json',  # Special handling needed
    },
    'disable_batch': {
        'default': False,
        'env_var': 'OPENLIT_DISABLE_BATCH',
        'cli_help': 'Disable batch span processing',
        'cli_type': bool,
    },
    'capture_message_content': {
        'default': True,
        'env_var': 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
        'cli_help': 'Enable capture of message content',
        'cli_type': bool,
        'has_negation': True,  # Supports --no_capture_message_content
    },
    'disabled_instrumentors': {
        'default': None,
        'env_var': 'OPENLIT_DISABLED_INSTRUMENTORS',
        'cli_help': 'Comma-separated list of instrumentors to disable',
        'cli_type': str,
        'parser': 'csv',  # Special handling needed
    },
    'disable_metrics': {
        'default': False,
        'env_var': 'OPENLIT_DISABLE_METRICS',
        'cli_help': 'Disable metrics collection',
        'cli_type': bool,
    },
    'pricing_json': {
        'default': None,
        'env_var': 'OPENLIT_PRICING_JSON',
        'cli_help': 'File path or URL to pricing JSON',
        'cli_type': str,
    },
    'collect_gpu_stats': {
        'default': False,
        'env_var': 'OPENLIT_COLLECT_GPU_STATS',
        'cli_help': 'Enable GPU statistics collection',
        'cli_type': bool,
    },
    'detailed_tracing': {
        'default': True,
        'env_var': 'OPENLIT_DETAILED_TRACING',
        'cli_help': 'Enable detailed component-level tracing',
        'cli_type': bool,
        'has_negation': True,  # Supports --no_detailed_tracing
    },
    
    # Parameters that are not exposed via CLI (internal use only)
    'tracer': {
        'default': None,
        'internal': True,  # Skip in CLI
    },
    'event_logger': {
        'default': None,
        'internal': True,  # Skip in CLI
    },
    'meter': {
        'default': None,
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


def generate_init_signature() -> str:
    """
    Generate the openlit.init() function signature from PARAMETER_CONFIG.
    This ensures the signature stays in sync with the config.
    """
    params = []
    for param_name, config in PARAMETER_CONFIG.items():
        default = config.get('default')
        if default is None:
            params.append(f"{param_name}=None")
        elif isinstance(default, str):
            params.append(f'{param_name}="{default}"')
        elif isinstance(default, bool):
            params.append(f"{param_name}={default}")
        else:
            params.append(f"{param_name}={default}")
    
    return "def init(\n    " + ",\n    ".join(params) + "\n):"


def get_init_defaults() -> Dict[str, Any]:
    """Get default values for all openlit.init() parameters."""
    return {param: config.get('default') for param, config in PARAMETER_CONFIG.items()}


def validate_parameters():
    """
    Validate that PARAMETER_CONFIG is in sync with openlit.init() signature.
    This should be called during development/testing to catch mismatches.
    """
    try:
        init_params = get_openlit_init_signature()
        config_params = set(PARAMETER_CONFIG.keys())
        init_param_names = set(init_params.keys())
        
        # Check for parameters in init but not in config
        missing_in_config = init_param_names - config_params
        if missing_in_config:
            print(f"⚠️  Parameters in openlit.init() but not in PARAMETER_CONFIG: {missing_in_config}")
            print("Consider adding them to PARAMETER_CONFIG or marking as internal.")
        
        # Check for parameters in config but not in init  
        extra_in_config = config_params - init_param_names
        if extra_in_config:
            print(f"⚠️  Parameters in PARAMETER_CONFIG but not in openlit.init(): {extra_in_config}")
            print("The openlit.init() signature may need to be updated.")
            print("Suggested signature:")
            print(generate_init_signature())
        
        if not missing_in_config and not extra_in_config:
            print("✅ Parameter configuration is in sync with openlit.init()")
            return True
            
    except Exception as e:
        print(f"❌ Parameter validation failed: {e}")
        return False
    
    return False


if __name__ == "__main__":
    # Run validation when module is executed directly
    try:
        validate_parameters()
        print("✅ Parameter configuration is in sync with openlit.init()")
    except ValueError as e:
        print(f"❌ Parameter configuration validation failed: {e}")
        exit(1)