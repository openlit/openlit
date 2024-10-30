# pylint: disable=duplicate-code, no-name-in-module
"""Utiliy functions for openlit.guard"""

import re
import json
import os
from typing import Optional, Tuple
from pydantic import BaseModel

from opentelemetry.metrics import get_meter
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from anthropic import Anthropic
from openai import OpenAI
from openlit.semcov import SemanticConvetion

class JsonOutput(BaseModel):
    """
    A model representing the structure of JSON output for prompt injection detection.

    Attributes:
        score (float): The score of the prompt injection likelihood.
        classification (str): The classification of prompt injection detected.
        explanation (str): A detailed explanation of the detection.
    """

    score: float
    classification: str
    explanation: str

def setup_provider(provider: Optional[str], api_key: Optional[str],
                   model: Optional[str],
                   base_url: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Sets up the provider, API key, model, and base URL.

    Args:
        provider (Optional[str]): The name of the LLM provider.
        api_key (Optional[str]): The API key for authenticating with the LLM.
        model (Optional[str]): The name of the model to use in the LLM.
        base_url (Optional[str]): The base URL for the LLM API.

    Returns:
        Tuple: The API key, model, base URL, and system prompt.

    Raises:
        ValueError: If the provider is unsupported or if the API key is not provided.
    """
    provider_configs = {
        "openai": {"env_var": "OPENAI_API_KEY"},
        "anthropic": {"env_var": "ANTHROPIC_API_KEY"}
    }

    if provider is None:
        return None, None, None

    provider = provider.lower()
    if provider not in provider_configs:
        raise ValueError(f"Unsupported provider: {provider}")

    config = provider_configs[provider]
    env_var = config["env_var"]

    # Handle API key
    if api_key:
        os.environ[env_var] = api_key
    api_key = os.getenv(env_var)

    if not api_key:
        # pylint: disable=line-too-long
        raise ValueError(f"API key required via 'api_key' parameter or '{env_var}' environment variable")

    return api_key, model, base_url


def format_prompt(system_prompt: str, text: str) -> str:
    """
    Format the prompt.

    Args:
        sysytem_prompt (str): The system prompt to send to the LLM.
        text: The prompt from the user

    Returns:
        str: The formatted prompt.
    """

    return system_prompt.replace("{{prompt}}", text)

def llm_response(provider: str, prompt: str, model: str, base_url: str) -> str:
    """
    Generates an LLM response using the configured provider.

    Args:
        prompt (str): The formatted prompt to send to the LLM.

    Returns:
        str: The response from the LLM as a string.
    """

    # pylint: disable=no-else-return
    if provider.lower() == "openai":
        return llm_response_openai(prompt, model, base_url)
    elif provider.lower() == "anthropic":
        return llm_response_anthropic(prompt, model)
    else:
        raise ValueError(f"Unsupported provider: {provider}")

def llm_response_openai(prompt: str, model: str, base_url: str) -> str:
    """
    Interacts with the OpenAI API to get a LLM response.

    Args:
        prompt (str): The prompt to send to the OpenAI LLM.

    Returns:
        str: The content of the response from OpenAI.
    """

    client = OpenAI(base_url=base_url)

    if model is None:
        model = "gpt-4o"

    if base_url is None:
        base_url = "https://api.openai.com/v1"

    response = client.beta.chat.completions.parse(
        model=model,
        messages=[
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        response_format=JsonOutput
    )
    return response.choices[0].message.content

def llm_response_anthropic(prompt: str, model: str) -> str:
    """
    Interacts with the Anthropic API to get a LLM response.

    Args:
        prompt (str): The prompt to send to the Anthropic LLM.

    Returns:
        str: The content of the response from Anthropic.
    """

    client = Anthropic()

    if model is None:
        model = "claude-3-opus-20240229"

    tools = [
        {
            "name": "prompt_analysis",
            "description": "Prints the Prompt Injection score of a given prompt.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "score": {"type": "number", "description": "prompt score from Guard."},
                    "classification": {"type": "number", "description": "Incorrect prompt type"},
                    "explanation": {"type": "number", "description": "reason for classification"}
                },
                "required": ["score", "classification", "explanation"]
            }
        }
    ]

    response = client.messages.create(
        model=model,
        messages=[
            {"role": "user", "content": prompt}
        ],
        max_tokens=2000,
        temperature=0.0,
        tools=tools,
        stream=False
    )

    for content in response.content:
        if content.type == "tool_use" and content.name == "prompt_analysis":
            response = content.input
            break

    return response

def parse_llm_response(response) -> JsonOutput:
    """
    Parses the LLM response into a JsonOutput object.

    Args:
        response: The response from the LLM, expected to be a JSON string or a dictionary.

    Returns:
        JsonOutput: The structured output representing the LLM's assessment.
    """

    try:
        if isinstance(response, str):
            data = json.loads(response)
        elif isinstance(response, dict):
            data = response
        else:
            raise TypeError("Response must be a JSON string or a dictionary.")

        return JsonOutput(**data)
    except (json.JSONDecodeError, TypeError) as e:
        print(f"Error parsing LLM response: {e}")
        return JsonOutput(score=0, classification="none", explanation="none")

def custom_rule_detection(text: str, custom_rules: list) -> JsonOutput:
    """
    Detects prompt injection using custom defined rules.

    Args:
        text (str): The text to analyze against custom rules.

    Returns:
        JsonOutput: The structured output based on custom rule matches.
    """

    for rule in custom_rules:
        if re.search(rule["pattern"], text):
            return JsonOutput(
                score=rule.get("score", 0.5),
                classification=rule.get("classification", "custom"),
                explanation=rule.get("explanation")
            )
    return JsonOutput(score=0, classification="none", explanation="none")

def guard_metrics():
    """
    Initializes OpenTelemetry meter and counter.

    Returns:
        counter: The initialized telemetry counter.
    """

    meter = get_meter(
        __name__,
        "0.1.0",
        schema_url="https://opentelemetry.io/schemas/1.11.0",
    )

    guard_requests = meter.create_counter(
        name=SemanticConvetion.GUARD_REQUESTS,
        description="Counter for Guard requests",
        unit="1"
    )

    return guard_requests

def guard_metric_attributes(score, validator, classification, explanation):
    """
    Initializes OpenTelemetry attributes for metrics.

    Args:
        score (float): The name of the attribute for Guard Score.
        validator (str): The name of the attribute for Guard.
        classification (str): The name of the attribute for Guard classification.
        explaination (str): The name of the attribute for Guard explanation.

    Returns:
        counter: The initialized telemetry counter.
    """

    return {
            TELEMETRY_SDK_NAME:
                "openlit",
            SemanticConvetion.GUARD_SCORE:
                score,
            SemanticConvetion.GUARD_VALIDATOR:
                validator,
            SemanticConvetion.GUARD_CLASSIFICATION:
                classification,
            SemanticConvetion.GUARD_EXPLANATION:
                explanation,
    }
