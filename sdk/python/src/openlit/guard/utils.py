import re
import json
from pydantic import BaseModel
from typing import Optional, Tuple
import os

class JsonOutput(BaseModel):
    """
    A model representing the structure of JSON output for prompt injection detection.

    Attributes:
        score (float): The score of the prompt injection likelihood.
        type (str): The type of prompt injection detected.
        explanation (str): A detailed explanation of the detection.
    """

    score: float
    type: str
    explanation: str

def setup_provider(provider: Optional[str], api_key: Optional[str], model: Optional[str], base_url: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Sets up the provider, API key, model, and base URL.

    Args:
        provider (Optional[str]): The name of the LLM provider.
        api_key (Optional[str]): The API key for authenticating with the LLM.
        model (Optional[str]): The name of the model to use in the LLM.
        base_url (Optional[str]): The base URL for the LLM API.

    Returns:
        Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]: The API key, model, base URL, and system prompt.

    Raises:
        ValueError: If the provider is unsupported or if the API key is not provided.
    """
    if provider is not None:
        if provider.lower() == "openai":
            env_var = "OPENAI_API_KEY"
        elif provider.lower() == "anthropic":
            env_var = "ANTHROPIC_API_KEY"
        else:
            raise ValueError(f"Unsupported provider: {provider}")

        # Set environment variable for API key if it is provided
        if api_key:
            os.environ[env_var] = api_key

        # Fetch API key from environment variable if not provided via function argument
        api_key = os.getenv(env_var)

        if not api_key:
            raise ValueError(f"An API key must be provided either via the 'api_key' parameter or by setting the '{env_var}' environment variable.")

        model = model
        base_url = base_url

        return api_key, model, base_url
    return None, None, None


def format_prompt(system_prompt: str, text: str) -> str:
    return system_prompt.replace("{{prompt}}", text)

def llm_response(provider: str, prompt: str, model: str, base_url: str) -> str:
        """
        Generates an LLM response using the configured provider.

        Args:
            prompt (str): The formatted prompt to send to the LLM.

        Returns:
            str: The response from the LLM as a string.
        """

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

    from openai import OpenAI
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

    from anthropic import Anthropic
    client = Anthropic()

    if model is None:
        model = "claude-3-opus-20240229"

    tools = [
        {
            "name": "prompt_injection_analysis",
            "description": "Prints the Prompt Injection score of a given prompt.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "score": {"type": "number", "description": "The positive sentiment score, ranging from 0.0 to 1.0."},
                    "type": {"type": "number", "description": "The negative sentiment score, ranging from 0.0 to 1.0."},
                    "explanation": {"type": "number", "description": "The neutral sentiment score, ranging from 0.0 to 1.0."}
                },
                "required": ["score", "type", "explanation"]
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
        if content.type == "tool_use" and content.name == "prompt_injection_analysis":
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
        return JsonOutput(score=0, type="none", explanation="none")

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
                type=rule.get("type", "custom"),
                explanation=rule.get("explanation")
            )
    return JsonOutput(score=0, type="none", explanation="none")