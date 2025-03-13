# pylint: disable=bare-except, broad-exception-caught
"""
This module has functions to calculate model costs based on tokens and to fetch pricing information.
"""
import os
import json
import logging
from urllib.parse import urlparse
from typing import Any, Dict, List, Tuple
import math
import requests
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode
from opentelemetry._events import Event
from openlit.semcov import SemanticConvetion

# Set up logging
logger = logging.getLogger(__name__)

def response_as_dict(response):
    """
    Return parsed response as a dict
    """

    # pylint: disable=no-else-return
    if isinstance(response, dict):
        return response
    if hasattr(response, 'model_dump'):
        return response.model_dump()
    elif hasattr(response, 'parse'):
        return response_as_dict(response.parse())
    else:
        return response

def get_env_variable(name, arg_value, error_message):
    """
    Retrieve an environment variable if the argument is not provided
    """

    if arg_value is not None:
        return arg_value
    value = os.getenv(name)
    if not value:
        logging.error(error_message)
        raise RuntimeError(error_message)
    return value

def general_tokens(text):
    """
    Calculate the number of tokens a given text would take up.
    """

    return math.ceil(len(text) / 2)

def get_chat_model_cost(model, pricing_info, prompt_tokens, completion_tokens):
    """
    Retrieve the cost of processing for a given model based on prompt and tokens.
    """

    try:
        cost = ((prompt_tokens / 1000) * pricing_info['chat'][model]['promptPrice']) + \
            ((completion_tokens / 1000) * pricing_info['chat'][model]['completionPrice'])
    except:
        cost = 0
    return cost

def get_embed_model_cost(model, pricing_info, prompt_tokens):
    """
    Retrieve the cost of processing for a given model based on prompt tokens.
    """

    try:
        cost = (prompt_tokens / 1000) * pricing_info['embeddings'][model]
    except:
        cost = 0
    return cost

def get_image_model_cost(model, pricing_info, size, quality):
    """
    Retrieve the cost of processing for a given model based on image size and quailty.
    """

    try:
        cost = pricing_info['images'][model][quality][size]
    except:
        cost = 0
    return cost

def get_audio_model_cost(model, pricing_info, prompt, duration=None):
    """
    Retrieve the cost of processing for a given model based on prompt.
    """

    try:
        if prompt:
            cost = (len(prompt) / 1000) * pricing_info['audio'][model]
        else:
            cost = duration * pricing_info['audio'][model]
    except:
        cost = 0
    return cost

def fetch_pricing_info(pricing_json=None):
    """
    Fetches pricing information from a specified URL or File Path.
    """

    if pricing_json:
        is_url = urlparse(pricing_json).scheme != ''
        if is_url:
            pricing_url = pricing_json
        else:
            try:
                with open(pricing_json, mode='r', encoding='utf-8') as f:
                    return json.load(f)
            except FileNotFoundError:
                logger.error('Pricing information file not found: %s', pricing_json)
            except json.JSONDecodeError:
                logger.error('Error decoding JSON from file: %s', pricing_json)
            except Exception as file_err:
                logger.error('Unexpected error occurred while reading file: %s', file_err)
            return {}
    else:
        pricing_url = 'https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json'
    try:
        # Set a timeout of 10 seconds for both the connection and the read
        response = requests.get(pricing_url, timeout=20)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as http_err:
        logger.error('HTTP error occured while fetching pricing info: %s', http_err)
    except Exception as err:
        logger.error('Unexpected error occurred while fetching pricing info: %s', err)
    return {}

def handle_exception(span,e):
    """Handles Exception when LLM Function fails or trace creation fails."""

    span.record_exception(e)
    span.set_status(Status(StatusCode.ERROR))

def calculate_ttft(timestamps: List[float], start_time: float) -> float:
    """
    Calculate the time to the first tokens.
    """

    if timestamps:
        return timestamps[0] - start_time
    return 0.0

def calculate_tbt(timestamps: List[float]) -> float:
    """
    Calculate the average time between tokens.
    """

    if len(timestamps) > 1:
        time_diffs = [timestamps[i] - timestamps[i - 1] for i in range(1, len(timestamps))]
        return sum(time_diffs) / len(time_diffs)
    return 0.0

def create_metrics_attributes(
    service_name: str,
    deployment_environment: str,
    operation: str,
    system: str,
    request_model: str,
    server_address: str,
    server_port: int,
    response_model: str,
) -> Dict[Any, Any]:
    """
    Returns OTel metrics attributes
    """

    return {
        TELEMETRY_SDK_NAME: 'openlit',
        SERVICE_NAME: service_name,
        DEPLOYMENT_ENVIRONMENT: deployment_environment,
        SemanticConvetion.GEN_AI_OPERATION: operation,
        SemanticConvetion.GEN_AI_SYSTEM: system,
        SemanticConvetion.GEN_AI_REQUEST_MODEL: request_model,
        SemanticConvetion.SERVER_ADDRESS: server_address,
        SemanticConvetion.SERVER_PORT: server_port,
        SemanticConvetion.GEN_AI_RESPONSE_MODEL: response_model
    }

def set_server_address_and_port(client_instance: Any,
    default_server_address: str, default_server_port: int) -> Tuple[str, int]:
    """
    Determines and returns the server address and port based on the provided client's `base_url`,
    using defaults if none found or values are None.
    """

    # Try getting base_url from multiple potential attributes
    base_client = getattr(client_instance, '_client', None)
    base_url = getattr(base_client, 'base_url', None)

    if not base_url:
        # Attempt to get endpoint from instance._config.endpoint if base_url is not set
        config = getattr(client_instance, '_config', None)
        base_url = getattr(config, 'endpoint', None)

    if not base_url:
        # Attempt to get server_url from instance.sdk_configuration.server_url
        config = getattr(client_instance, 'sdk_configuration', None)
        base_url = getattr(config, 'server_url', None)

    if base_url:
        if isinstance(base_url, str):
            url = urlparse(base_url)
            server_address = url.hostname or default_server_address
            server_port = url.port if url.port is not None else default_server_port
        else:  # base_url might not be a str; handle as an object.
            server_address = getattr(base_url, 'host', None) or default_server_address
            port_attr = getattr(base_url, 'port', None)
            server_port = port_attr if port_attr is not None else default_server_port
    else:  # no base_url or endpoint provided; use defaults.
        server_address = default_server_address
        server_port = default_server_port

    return server_address, server_port

def otel_event(name, attributes, body):
    """
    Returns an OpenTelemetry Event object
    """

    return Event(
        name=name,
        attributes=attributes,
        body=body,
    )

def extract_and_format_input(messages):
    """
    Process a list of messages to extract content and categorize
    them into fixed roles like 'user', 'assistant', 'system', 'tool'.
    """

    fixed_roles = ['user', 'assistant', 'system', 'tool']  # Ensure these are your fixed keys
    # Initialize the dictionary with fixed keys and empty structures
    formatted_messages = {role_key: {'role': '', 'content': ''} for role_key in fixed_roles}

    for message in messages:
        # Normalize the message structure
        message = response_as_dict(message)

        # Extract role and content
        role = message.get('role')
        if role not in fixed_roles:
            continue  # Skip any role not in our predefined roles

        content = message.get('content', '')

        # Prepare content as a string
        if isinstance(content, list):
            content_str = ", ".join(
                f'{item.get("type", "text")}: {extract_text_from_item(item)}'
                for item in content
            )
        else:
            content_str = content

        # Set the role in the formatted message and concatenate content
        if not formatted_messages[role]['role']:
            formatted_messages[role]['role'] = role

        if formatted_messages[role]['content']:
            formatted_messages[role]['content'] += ' ' + content_str
        else:
            formatted_messages[role]['content'] = content_str

    return formatted_messages

def extract_text_from_item(item):
    """
    Extract text from inpit message
    """

    #pylint: disable=no-else-return
    if item.get('type') == 'text':
        return item.get('text', '')
    elif item.get('type') == 'image':
        # Handle image content specifically checking for 'url' or 'base64'
        source = item.get('source', {})
        if isinstance(source, dict):
            if source.get('type') == 'base64':
                # Return the actual base64 data if present
                return source.get('data', '[Missing base64 data]')
            elif source.get('type') == 'url':
                return source.get('url', '[Missing URL]')
    elif item.get('type') == 'image_url':
        # New format: Handle the 'image_url' type
        image_url = item.get('image_url', {})
        if isinstance(image_url, dict):
            return image_url.get('url', '[Missing image URL]')
    return ''

# To be removed one the change to log events (from span events) is complete
def concatenate_all_contents(formatted_messages):
    """
    Concatenate all 'content' fields into a single strin
    """
    return ' '.join(
        message_data['content']
        for message_data in formatted_messages.values()
        if message_data['content']
    )
