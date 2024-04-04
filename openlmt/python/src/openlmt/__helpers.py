"""
This moduel has send_data functions to be used by other modules.
"""

import logging
import requests
import tiktoken

def openai_tokens(text, model):
    try:
      encoding = tiktoken.encoding_for_model(model)
    except:
      encoding = tiktoken.get_encoding("cl100k_base")

    num_tokens = len(encoding.encode(text))
    return num_tokens

def get_chat_model_cost(model, pricing_info, promptTokens, completionTokens):
    """
    Retrieve the prompt and completion cost of a given chat model 
    from the stored pricing information.
    """
    try:
        cost = ((promptTokens / 1000) * pricing_info["chat"][model]["promptPrice"]) + ((completionTokens / 1000) * pricing_info["chat"][model]["completionPrice"])
    except:
        cost = 0
    return cost

def get_embed_model_cost(model, pricing_info, promptTokens):
    """
    Retrieve the prompt cost of a given Embedding model 
    from the stored pricing information.
    """
    try:
        cost = ((promptTokens / 1000) * pricing_info["embeddings"][model])
    except:
        cost = 0
    return cost

def get_image_model_cost(model, pricing_info, size, quality):
    """
    Retrieve the prompt cost of a given Image model 
    from the stored pricing information.
    """
    try:
        cost = pricing_info["images"][model][quality][size]
    except:
        cost = 0
    return cost

def get_audio_model_cost(model, pricing_info, prompt):
    """
    Retrieve the prompt cost of a given Image model 
    from the stored pricing information.
    """
    try:
        cost = (len(prompt) / 1000) * pricing_info["audio"][model]
    except:
        cost = 0
    return cost