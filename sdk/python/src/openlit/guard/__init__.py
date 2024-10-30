# pylint: line-too-long

"""
openlit.guard

This module provides a set of classes for analyzing text for various types of content-based vulnerabilities,
such as prompt injection, topic restriction, and sensitive topic detection.

Submodules:
-----------
- prompt_injection: Contains the `PromptInjection` class for detecting prompt injections in text.
- sensitive_topic: Contains the `SensitiveTopic` class for identifying sensitive topics within a text.
- restrict_topic: Contains the `RestrictTopic` class for validating whether a piece of text falls within allowed topics.
- all: Contains the `All` class for performing comprehensive analysis combining the functionalities of the aforementioned submodules.

Classes:
--------
- PromptInjection: Detects and categorizes instances of prompt injections using defined criteria.
- SensitiveTopic: Identifies sensitive topics that may require special handling based on societal norms or company policies.
- RestrictTopic: Validates text based on a predefined set of valid topics, ensuring that irrelevant or unauthorized content is flagged.
- All: Provides a unified interface for analyzing text for prompt injections, topic validity, and sensitive topics, offering a comprehensive detection capability in a single class.
"""

from openlit.guard.prompt_injection import PromptInjection
from openlit.guard.sensitive_topic import SensitiveTopic
from openlit.guard.restrict_topic import RestrictTopic
from openlit.guard.all import All
