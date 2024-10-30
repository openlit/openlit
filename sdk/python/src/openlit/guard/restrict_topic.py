# pylint: disable=duplicate-code, line-too-long, too-few-public-methods, too-many-instance-attributes
"""
Module for validating valid topics in Prompt.
"""

from typing import Optional, List, Dict
from openlit.guard.utils import (
    setup_provider,
    JsonOutput,
    format_prompt,
    llm_response,
    parse_llm_response,
    guard_metrics,
    guard_metric_attributes
)

def get_system_prompt(valid_topics: Optional[List[str]] = None) -> str:
    """
    Returns the system prompt used for LLM analysis, including custom categories if provided.

    Args:
        valid_topics (Optional[List[str]]): List of valid topics.
    Returns:
        str: The system prompt string.
    """
    base_prompt = """
    Output Requirement: JSON Format Only

    Your task is to analyze the provided text and determine if it falls within the specified valid topics. Apply strict criteria in your assessment.

    The text should be categorized based on the predefined topics. If the text does not fit into one of these categories, it should be marked as an invalid topic.

    Presented Text:
    {{prompt}}

    Expected JSON Structure:

    {
        "score": "float",
        "classification": "TYPE_OF_TOPIC",
        "explanation": "Detailed reason"
    }

    Scoring System:
    - The score ranges from 0 to 1. Treat scores above 0.75 as indicating a strong detection of an invalid topic.

    Categories of Valid Topics (use only these categories):
    """

    # Add valid topics to the prompt if provided
    if valid_topics:
        valid_topics_str = "\n".join([f"- {topic}" for topic in valid_topics])
        base_prompt += valid_topics_str
    else:
        base_prompt += "- No predefined categories. All topics are considered invalid unless matched by custom rules."

    base_prompt += """

    Final Steps:
    - If the text does not fit into one of the above categories, the return should be: {"score": 1.0, "classification": "invalid_topic", "explanation": "The topic does not match any valid categories."}.
    - If the text does fit into one of the above categories, the return should be: {"score": 0.0, "classification": "valid_topic", "explanation": "The reason why the text fits into a valid classification, specifying the classification and context."}.
    """

    return base_prompt

class RestrictTopic:
    """
    A class to detect sensitive topics using LLM or custom rules.

    Attributes:
        provider (Optional[str]): The name of the LLM provider.
        api_key (Optional[str]): The API key for authenticating with the LLM.
        model (Optional[str]): The name of the model to use in the LLM.
        base_url (Optional[str]): The base URL for the LLM API.
        valid_topics (Optional[List[str]]): List of valid topics.
    """

    def __init__(self, provider: Optional[str], api_key: Optional[str] = None,
                 model: Optional[str] = None, base_url: Optional[str] = None,
                 valid_topics: Optional[List[str]] = None,
                 collect_metrics: Optional[bool] = False):
        """
        Initializes the RestrictTopic with specified LLM settings, custom rules, and categories.

        Args:
            provider (Optional[str]): The name of the LLM provider.
            api_key (Optional[str]): The API key for authenticating with the LLM.
            model (Optional[str]): The name of the model to use in the LLM.
            base_url (Optional[str]): The base URL for the LLM API.
            valid_topics (Optional[List[str]]): List of valid topics.

        Raises:
            ValueError: If provider or api_key is not specified.
        """

        self.provider = provider
        if self.provider is None:
            raise ValueError("An LLM provider must be specified for RestrictTopic Validator")
        self.api_key, self.model, self.base_url = setup_provider(provider, api_key, model, base_url)
        self.system_prompt = get_system_prompt(valid_topics)
        self.valid_topics = valid_topics or []
        self.collect_metrics = collect_metrics

    def detect(self, text: str) -> JsonOutput:
        """
        Detects sensitive topics using either LLM or custom rules.

        Args:
            text (str): The text to analyze for sensitive topics.

        Returns:
            JsonOutput: The result containing score, classification, and explanation of sensitive topic detection.
        """

        prompt = format_prompt(self.system_prompt, text)
        response = llm_response(self.provider, prompt, self.model, self.base_url)
        llm_result = parse_llm_response(response)

        if llm_result.score == 0.0 and llm_result.classification == "valid_topic":
            result = JsonOutput(score=llm_result.score, classification="valid_topic", explanation=llm_result.explanation)
        else:
            result = JsonOutput(score=llm_result.score, classification="invalid_topic", explanation=llm_result.explanation)

        if self.collect_metrics is True:
            guard_counter = guard_metrics()
            attributes = guard_metric_attributes(result.score, "restrict_to_topic",
                                                 result.classification, result.explanation)
            guard_counter.add(1, attributes)

        return result
