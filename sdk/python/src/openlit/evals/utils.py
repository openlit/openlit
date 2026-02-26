# pylint: disable=duplicate-code, no-name-in-module
"""Utiliy functions for openlit.evals"""

import json
import os
import logging
from typing import Optional, Tuple, List
from pydantic import BaseModel
from anthropic import Anthropic
from openai import OpenAI
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


class JsonOutput(BaseModel):
    """
    A model representing the structure of JSON output for prompt injection detection.

    Attributes:
        verdict (str): Verdict if evluation passed or failed.
        score (float): The score of the prompt injection likelihood.
        classification (str): The classification of prompt injection detected.
        explanation (str): A detailed explanation of the detection.
    """

    verdict: str
    evaluation: str
    score: float
    classification: str
    explanation: str


def setup_provider(
    provider: Optional[str],
    api_key: Optional[str],
    model: Optional[str],
    base_url: Optional[str],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
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
        "anthropic": {"env_var": "ANTHROPIC_API_KEY"},
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
        raise ValueError(
            f"API key required via 'api_key' parameter or '{env_var}' environment variable"
        )

    return api_key, model, base_url


def format_prompt(
    system_prompt: str, prompt: str, contexts: List[str], text: str
) -> str:
    """
    Format the prompt.

    Args:
        system_prompt (str): The system prompt to send to the LLM.
        prompt (str): The prompt provided by the user.
        contexts (List[str]): A list of context sentences relevant to the task.
        text (str): The text to analyze.

    Returns:
        str: The formatted prompt.
    """

    context_str = "\n".join([f'- "{c}"' for c in contexts])
    formatted_prompt = system_prompt.replace("{{prompt}}", prompt)
    formatted_prompt = formatted_prompt.replace("{{context}}", context_str)
    formatted_prompt = formatted_prompt.replace("{{text}}", f'- "{text}"')

    return formatted_prompt


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
        model = "gpt-4o-mini"

    if base_url is None:
        base_url = "https://api.openai.com/v1"

    response = client.beta.chat.completions.parse(
        model=model,
        messages=[
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        response_format=JsonOutput,
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
                    "verdict": {"type": "string", "description": "Evaluation verdict"},
                    "evaluation": {"type": "string", "description": "Evaluation type"},
                    "score": {"type": "number", "description": "Evaluation score"},
                    "classification": {
                        "type": "string",
                        "description": "Evaluation category",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Evaluation reason",
                    },
                },
                "required": [
                    "verdict",
                    "evaluation",
                    "score",
                    "classification",
                    "explanation",
                ],
            },
        }
    ]

    response = client.messages.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.0,
        tools=tools,
        stream=False,
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
        logger.error("Error parsing LLM response: '%s'", e)
        return JsonOutput(
            score=0,
            classification="none",
            explanation="none",
            verdict="no",
            evaluation="none",
        )


def emit_evaluation_event(
    event_provider,
    evaluation_name,
    score_value=None,
    score_label=None,
    explanation=None,
    response_id=None,
    error_type=None,
):
    """
    Emit gen_ai.evaluation.result event per OTel semantic conventions.

    Args:
        event_provider: The OTel event provider
        evaluation_name: Name of evaluation (hallucination, bias_detection, toxicity_detection)
        score_value: Numerical score 0.0-1.0 (conditionally required)
        score_label: Human-readable label (yes/no or pass/fail) (conditionally required)
        explanation: Brief explanation of evaluation result (recommended)
        response_id: Optional response ID for correlation (recommended when available)
        error_type: Error type if evaluation failed (conditionally required if error occurs)
    """
    try:
        if not event_provider:
            return

        from openlit.__helpers import otel_event

        # Build event attributes per OTel semantic convention spec
        attributes = {
            SemanticConvention.GEN_AI_EVALUATION_NAME: evaluation_name,
        }

        # If error occurred, record error.type instead of score attributes
        if error_type:
            attributes[SemanticConvention.ERROR_TYPE] = error_type
        else:
            # Record evaluation score and label (conditionally required if no error)
            if score_value is not None:
                attributes[SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE] = float(
                    score_value
                )
            if score_label:
                attributes[SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL] = (
                    score_label
                )

        # Add recommended attributes when available
        if explanation:
            attributes[SemanticConvention.GEN_AI_EVALUATION_EXPLANATION] = explanation
        if response_id:
            attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = response_id

        # Create and emit event per OTel spec
        event = otel_event(
            name=SemanticConvention.GEN_AI_EVALUATION_RESULT,
            attributes=attributes,
            body="",  # Per spec, all data must be in attributes, body is empty
        )

        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit evaluation event: %s", e, exc_info=True)
