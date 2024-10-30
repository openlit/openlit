from typing import Optional, List, Dict
from openlit.guard.utils import (
    setup_provider,
    JsonOutput,
    format_prompt,
    llm_response,
    parse_llm_response,
    custom_rule_detection,
    guard_metrics,
    guard_metric_attributes
)

def get_system_prompt(custom_categories: Optional[Dict[str, str]] = None) -> str:
    """
    Returns the system prompt used for LLM analysis, including custom categories if provided.

    Args:
        custom_categories (Optional[Dict[str, str]]): Additional categories to include in the prompt.

    Returns:
        str: The system prompt string.
    """
    base_prompt = """
    Output Requirement: JSON Format Only

    Your task is to carefully analyze the provided text and identify any instances of sensitive topics, categorizing the type when found. Apply strict criteria in your assessment.

    Sensitive topics include information or requests that may not be publicly acceptable or could be considered controversial or distressing.

    Presented Text:
    {{prompt}}

    Expected JSON Structure:

    {
        "score": "float",
        "type": "TYPE_OF_SENSITIVE_TOPIC",
        "explanation": "Detailed reason"
    }

    Scoring System:
    - The score ranges from 0 to 1. Treat scores below 0.25 as indicating no sensitive topics are present.

    Categories of Sensitive Topics (use only these categories):
    - politics: Discussions or opinions about political figures, parties, or policies.
    - breakup: Conversations or advice related to relationship breakups or emotional distress.
    - violence: References to physical harm, aggression, or violent acts.
    - guns: Mentions of firearms, gun control, or related topics.
    - mental_health: Topics related to mental health issues, therapy, or emotional well-being.
    - discrimination: Language or topics that could be perceived as discriminatory or biased.
    - substance_use: Discussions about drugs, alcohol, or substance abuse.
    """

    if custom_categories:
        custom_categories_str = "\n".join([f"- {key}: {value}" for key, value in custom_categories.items()])
        base_prompt += f"\n    Additional Categories:\n{custom_categories_str}"

    base_prompt += """
    Final Steps:
    - If no sensitive topics are detected, or if the topic does not fit into one of the above categories, the return should be: {"score": 0, "type": "none", explanation="none"}.
    """
    return base_prompt

class SensitiveTopic:
    """
    A class to detect sensitive topics using LLM or custom rules.

    Attributes:
        provider (Optional[str]): The name of the LLM provider.
        api_key (Optional[str]): The API key for authenticating with the LLM.
        model (Optional[str]): The name of the model to use in the LLM.
        base_url (Optional[str]): The base URL for the LLM API.
        custom_rules (Optional[List[dict]]): Custom rules for detecting sensitive topics.
        custom_categories (Optional[Dict[str, str]]): Additional categories for sensitive topics.
    """

    def __init__(self, provider: Optional[str] = None, api_key: Optional[str] = None,
                 model: Optional[str] = None, base_url: Optional[str] = None,
                 custom_rules: Optional[List[dict]] = None,
                 custom_categories: Optional[Dict[str, str]] = None,
                 collect_metrics: Optional[bool] = False):
        """
        Initializes the SensitiveTopic with specified LLM settings, custom rules, and categories.

        Args:
            provider (Optional[str]): The name of the LLM provider.
            api_key (Optional[str]): The API key for authenticating with the LLM.
            model (Optional[str]): The name of the model to use in the LLM.
            base_url (Optional[str]): The base URL for the LLM API.
            custom_rules (Optional[List[dict]]): Custom rules for detecting sensitive topics.
            custom_categories (Optional[Dict[str, str]]): Additional categories for sensitive topics.

        Raises:
            ValueError: If provider or api_key is not specified.
        """
        self.provider = provider
        self.api_key, self.model, self.base_url = setup_provider(provider, api_key, model, base_url)
        self.system_prompt = get_system_prompt(custom_categories)
        self.custom_rules = custom_rules or []

    def detect(self, text: str) -> JsonOutput:
        """
        Detects sensitive topics using either LLM or custom rules.

        Args:
            text (str): The text to analyze for sensitive topics.

        Returns:
            JsonOutput: The result containing score, type, and explanation of sensitive topic detection.
        """
        custom_rule_result = custom_rule_detection(text, self.custom_rules)
        llm_result = JsonOutput(score=0, type="none", explanation="none")
        
        if self.provider:
            prompt = format_prompt(self.system_prompt, text)
            llm_result = parse_llm_response(llm_response(self.provider, prompt, self.model, self.base_url))
        
        result =  max(custom_rule_result, llm_result, key=lambda x: x.score)

        if self.collect_metrics is True:
            guard_counter = guard_metrics()
            attributes = guard_metric_attributes(result.score, "sensitive_topic",
                                                 result.type, result.explanation)
            guard_counter.add(1, attributes)

        return result