# pylint: disable=bare-except, broad-exception-caught
"""
This module has functions to calculate model costs based on tokens and to fetch pricing information.
"""
import json
import logging
from urllib.parse import urlparse
import requests
import tiktoken
from opentelemetry.trace import Status, StatusCode

# Set up logging
logger = logging.getLogger(__name__)

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

def get_audio_model_cost(model, pricing_info, prompt):
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
        cost = (len(prompt) / 1000) * pricing_info["audio"][model]
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
