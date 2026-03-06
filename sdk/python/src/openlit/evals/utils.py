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

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        response_format={"type": "json_object"},
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


def get_event_provider():
    """
    Safely retrieve the event provider from OpenLIT's global configuration.

    This function enables evaluators to auto-wire event emission without storing
    references that cause cyclic imports. The provider is retrieved at call time,
    allowing OpenLIT initialization to complete before evaluation measure() calls.

    Returns:
        The event provider if OpenLIT has been initialized with telemetry, else None.
    """
    try:
        # pylint: disable=cyclic-import
        # (Import is inside function body, executed only after openlit.init())
        from openlit import OpenlitConfig

        return OpenlitConfig.event_provider
    except (ImportError, AttributeError):
        return None


def get_evals_logs_export_config():
    """
    Safely retrieve the evals_logs_export flag from OpenLIT's global configuration.

    Returns:
        True if OTEL Log Records should be used instead of Events, else False.
    """
    try:
        # pylint: disable=cyclic-import
        from openlit import OpenlitConfig

        return getattr(OpenlitConfig, "evals_logs_export", True)
    except (ImportError, AttributeError):
        return True


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
    Emit gen_ai.evaluation.result as an OTel Event or OTel Log Record.

    By default, emits as an OTel Log Record. When ``evals_logs_export=False``
    is set in ``openlit.init()``, emits as an OTel Event instead (useful for
    backends that support events natively).

    Both paths carry the same keys and value types; the only difference is
    the transport (event attributes vs JSON string in the log body).

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

        attributes = {
            SemanticConvention.GEN_AI_EVALUATION_NAME: evaluation_name,
        }

        if error_type:
            attributes[SemanticConvention.ERROR_TYPE] = error_type
        else:
            if score_value is not None:
                attributes[SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE] = float(
                    score_value
                )
            if score_label:
                attributes[SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL] = (
                    score_label
                )

        if explanation:
            attributes[SemanticConvention.GEN_AI_EVALUATION_EXPLANATION] = explanation
        if response_id:
            attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = response_id

        if get_evals_logs_export_config():
            _emit_as_log_record(json.dumps(attributes))
        else:
            _emit_as_event(event_provider, attributes)

    except Exception as e:
        logger.warning("Failed to emit evaluation event: %s", e, exc_info=True)


def _emit_as_event(event_provider, attributes):
    """Emit evaluation result as an OTel Event (default path)."""
    from openlit.__helpers import otel_event

    event = otel_event(
        name=SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes=attributes,
        body="",
    )
    event_provider.emit(event)


def _emit_as_log_record(body):
    """Emit evaluation result as an OTel Log Record via the Logger API directly."""
    from opentelemetry._logs import get_logger_provider, LogRecord, SeverityNumber

    otel_logger = get_logger_provider().get_logger("openlit.evals")
    otel_logger.emit(
        LogRecord(
            body=body,
            severity_number=SeverityNumber.INFO,
        )
    )
