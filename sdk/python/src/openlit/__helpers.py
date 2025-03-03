# pylint: disable=bare-except, broad-exception-caught
"""
This module has functions to calculate model costs based on tokens and to fetch pricing information.
"""
import os
import json
import logging
from urllib.parse import urlparse
from typing import Any, Dict, List, Tuple
import requests
import tiktoken
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode
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
    if hasattr(response, "model_dump"):
        return response.model_dump()
    elif hasattr(response, "parse"):
        return response_as_dict(response.parse())
    else:
        return response

def get_env_variable(name, arg_value, error_message):
    """
    Retrieve an environment variable if the argument is not provided
    and raise an error if both are not set.
    """
    if arg_value is not None:
        return arg_value
    value = os.getenv(name)
    if not value:
        logging.error(error_message)
        raise RuntimeError(error_message)
    return value

def openai_tokens(text, model):
    """
    Calculate the number of tokens a given text would take up for a specified model.
    
    Args:
        text (str): The input text to be encoded.
        model (str): The model identifier used for encoding.
        
    Returns:
        int: The number of tokens the text is encoded into.
    """
    try:
        encoding = tiktoken.encoding_for_model(model)
    except:
        encoding = tiktoken.get_encoding("cl100k_base")

    num_tokens = len(encoding.encode(text))
    return num_tokens

def general_tokens(text):
    """
    Calculate the number of tokens a given text would take up.
    
    Args:
        text (str): The input text to be encoded.
        model (str): The model identifier used for encoding.
        
    Returns:
        int: The number of tokens the text is encoded into.
    """

    encoding = tiktoken.get_encoding("gpt2")

    num_tokens = len(encoding.encode(text))
    return num_tokens

def get_chat_model_cost(model, pricing_info, prompt_tokens, completion_tokens):
    """
    Retrieve the cost of processing for a given model based on prompt and tokens.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        prompt_tokens (int): Number of tokens in the prompt.
        completion_tokens (int): Number of tokens in the completion if applicable.
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        cost = ((prompt_tokens / 1000) * pricing_info["chat"][model]["promptPrice"]) + \
            ((completion_tokens / 1000) * pricing_info["chat"][model]["completionPrice"])
    except:
        cost = 0
    return cost

def get_embed_model_cost(model, pricing_info, prompt_tokens):
    """
    Retrieve the cost of processing for a given model based on prompt tokens.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        prompt_tokens (int): Number of tokens in the prompt.
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        cost = (prompt_tokens / 1000) * pricing_info["embeddings"][model]
    except:
        cost = 0
    return cost

def get_image_model_cost(model, pricing_info, size, quality):
    """
    Retrieve the cost of processing for a given model based on image size and quailty.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        size (str): Size of the Image.
        quality (int): Quality of the Image.
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        cost = pricing_info["images"][model][quality][size]
    except:
        cost = 0
    return cost

def get_audio_model_cost(model, pricing_info, prompt, duration=None):
    """
    Retrieve the cost of processing for a given model based on prompt.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        prompt (str): Prompt to the LLM Model
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        if prompt:
            cost = (len(prompt) / 1000) * pricing_info["audio"][model]
        else:
            cost = duration * pricing_info["audio"][model]
    except:
        cost = 0
    return cost

def fetch_pricing_info(pricing_json=None):
    """
    Fetches pricing information from a specified URL or File Path.

    Args:
        pricing_json(str): path or url to the pricing json file

    Returns:
        dict: The pricing json
    """
    if pricing_json:
        is_url = urlparse(pricing_json).scheme != ""
        if is_url:
            pricing_url = pricing_json
        else:
            try:
                with open(pricing_json, mode='r', encoding='utf-8') as f:
                    return json.load(f)
            except FileNotFoundError:
                logger.error("Pricing information file not found: %s", pricing_json)
            except json.JSONDecodeError:
                logger.error("Error decoding JSON from file: %s", pricing_json)
            except Exception as file_err:
                logger.error("Unexpected error occurred while reading file: %s", file_err)
            return {}
    else:
        pricing_url = "https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json"
    try:
        # Set a timeout of 10 seconds for both the connection and the read
        response = requests.get(pricing_url, timeout=20)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as http_err:
        logger.error("HTTP error occured while fetching pricing info: %s", http_err)
    except Exception as err:
        logger.error("Unexpected error occurred while fetching pricing info: %s", err)
    return {}

def handle_exception(span,e):
    """Handles Exception when LLM Function fails or trace creation fails."""
    # Record the exception details within the span
    span.record_exception(e)
    span.set_status(Status(StatusCode.ERROR))

def calculate_ttft(timestamps: List[float], start_time: float) -> float:
    """
    Calculate the time to the first tokens.
    
    :param timestamps: List of timestamps for received tokens
    :param start_time: The start time of the streaming process
    :return: Time to the first tokens
    """
    if timestamps:
        return timestamps[0] - start_time
    return 0.0

def calculate_tbt(timestamps: List[float]) -> float:
    """
    Calculate the average time between tokens.
    
    :param timestamps: List of timestamps for received tokens
    :return: Average time between tokens
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
        TELEMETRY_SDK_NAME: "openlit",
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
    base_client = getattr(client_instance, "_client", None)
    base_url = getattr(base_client, "base_url", None)

    if not base_url:
        # Attempt to get endpoint from instance._config.endpoint if base_url is not set
        config = getattr(client_instance, "_config", None)
        base_url = getattr(config, "endpoint", None)

    if not base_url:
        # Attempt to get server_url from instance.sdk_configuration.server_url
        config = getattr(client_instance, "sdk_configuration", None)
        base_url = getattr(config, "server_url", None)

    if base_url:
        if isinstance(base_url, str):
            url = urlparse(base_url)
            server_address = url.hostname or default_server_address
            server_port = url.port if url.port is not None else default_server_port
        else:  # base_url might not be a str; handle as an object.
            server_address = getattr(base_url, "host", None) or default_server_address
            port_attr = getattr(base_url, "port", None)
            server_port = port_attr if port_attr is not None else default_server_port
    else:  # no base_url or endpoint provided; use defaults.
        server_address = default_server_address
        server_port = default_server_port

    return server_address, server_port
