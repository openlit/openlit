"""
This module has functions to calculate model costs based on tokens and to fetch pricing information.
"""

import logging
import requests
import tiktoken

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

def get_chat_model_cost(model, pricing_info, promptTokens, completionTokens):
    """
    Retrieve the cost of processing for a given model based on prompt and tokens.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        promptTokens (int): Number of tokens in the prompt.
        completionTokens (int): Number of tokens in the completion if applicable.
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        cost = ((promptTokens / 1000) * pricing_info["chat"][model]["promptPrice"]) + \
            ((completionTokens / 1000) * pricing_info["chat"][model]["completionPrice"])
    except:
        cost = 0
    return cost

def get_embed_model_cost(model, pricing_info, promptTokens):
    """
    Retrieve the cost of processing for a given model based on prompt tokens.
    
    Args:
        model (str): The model identifier.
        pricing_info (dict): A dictionary containing pricing information for various models.
        promptTokens (int): Number of tokens in the prompt.
        
    Returns:
        float: The calculated cost for the operation.
    """
    try:
        cost = ((promptTokens / 1000) * pricing_info["embeddings"][model])
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

def fetch_pricing_info():
    """Fetches pricing information from a specified URL."""
    pricing_url = "https://raw.githubusercontent.com/patcher9/doku/main/assets/pricing.json"
    try:
        response = requests.get(pricing_url)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as http_err:
        logger.error(f"HTTP error occured while fetching pricing info: {http_err}")
    except Exception as err:
        logger.error(f"Unexpected error occurred while fetching pricing info: {err}")
    return {}