"""
__init__ module for dokumetry package.
"""
from .otel.tracing import setup_tracing

from anthropic import AsyncAnthropic, Anthropic
from openai import AsyncOpenAI, OpenAI, AzureOpenAI, AsyncAzureOpenAI
from mistralai.async_client import MistralAsyncClient
from mistralai.client import MistralClient

from .openai import OpenAIInstrumentor, AsyncOpenAIInstrumentor
from .azure_openai import AzureOpenAIInstrumentor, AsyncAzureOpenAIInstrumentor
from .anthropic import AnthropicInstrumentor, AsyncAnthropicInstrumentor
from .cohere import CohereInstrumentor
from .mistral import MistralInstrumentor, AsyncMistralInstrumentor

import requests

# pylint: disable=too-few-public-methods
class DokuConfig:
    """
    Configuration class for Doku initialization.
    """

    llm = None
    doku_url = None
    api_key = None
    environment = None
    application_name = None
    skip_resp = None
    pricing_info = {}


def fetch_pricing_info():
    """
    Fetches pricing information from a specified URL and caches it.
    """
    pricing_url = "https://raw.githubusercontent.com/patcher9/doku/main/assets/pricing.json"
    try:
        response = requests.get(pricing_url)
        response.raise_for_status()  # Raises an HTTPError for bad responses
        return response.json()
    except requests.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
    except Exception as err:
        print(f"An error occurred: {err}")
    return {}

# pylint: disable=too-many-arguments, line-too-long, too-many-return-statements
def init(llm, environment="default", application_name="default", skip_resp=False, tracer=None, exporter='console', otlp_endpoint=None, otlp_headers=None):    
    """
    Initialize Doku configuration. Allows passing a custom tracer. Supports 'console' and 'otlp' as exporters.

    Args:
        llm: Function determining the platform.
        environment (str): Environment identifier.
        application_name (str): Application name.
        skip_resp (bool): Whether to skip response processing.
        tracer: Optional custom tracer.
        exporter (str): Exporter choice. Supports 'console' (default) and 'otlp'.
    """

    DokuConfig.llm = llm
    DokuConfig.environment = environment
    DokuConfig.application_name = application_name
    DokuConfig.pricing_info = fetch_pricing_info()

    tracer = setup_tracing(exporter=exporter, application_name=application_name, tracer=tracer, otlp_endpoint=otlp_endpoint, otlp_headers=otlp_headers)

    #pylint: disable=no-else-return, line-too-long
    if hasattr(llm, 'moderations') and callable(llm.chat.completions.create) and ('.openai.azure.com/' not in str(llm.base_url)):
        if isinstance(llm, AsyncOpenAI):
            AsyncOpenAIInstrumentor().instrument(
                llm = DokuConfig.llm,
                environment = DokuConfig.environment,
                application_name = DokuConfig.application_name,
                tracer = tracer,
                pricing_info =  DokuConfig.pricing_info,
            )
            return
        elif isinstance(llm, OpenAI):
            OpenAIInstrumentor().instrument(
                llm = DokuConfig.llm,
                environment = DokuConfig.environment,
                application_name = DokuConfig.application_name,
                tracer = tracer,
                pricing_info =  DokuConfig.pricing_info,
            )
            return
    # pylint: disable=no-else-return, line-too-long
    elif hasattr(llm, 'moderations') and callable(llm.chat.completions.create) and ('.openai.azure.com/' in str(llm.base_url)):
        if isinstance(llm, AsyncAzureOpenAI):
            AsyncAzureOpenAIInstrumentor().instrument(
                llm = DokuConfig.llm,
                environment = DokuConfig.environment,
                application_name = DokuConfig.application_name,
                tracer = tracer,
                pricing_info =  DokuConfig.pricing_info,
            )
            return
        elif isinstance(llm, AzureOpenAI):
            AzureOpenAIInstrumentor().instrument(
                llm = DokuConfig.llm,
                environment = DokuConfig.environment,
                application_name = DokuConfig.application_name,
                tracer = tracer,
                pricing_info =  DokuConfig.pricing_info,
            )
            return
    elif isinstance(llm, MistralAsyncClient):
        AsyncMistralInstrumentor().instrument(
            llm = DokuConfig.llm,
            environment = DokuConfig.environment,
            application_name = DokuConfig.application_name,
            tracer = tracer,
            pricing_info =  DokuConfig.pricing_info,
        )
        return
    elif isinstance(llm, MistralClient):
        MistralInstrumentor().instrument(
            llm = DokuConfig.llm,
            environment = DokuConfig.environment,
            application_name = DokuConfig.application_name,
            tracer = tracer,
            pricing_info =  DokuConfig.pricing_info,
        )
        return
    elif isinstance(llm, Anthropic):
        AnthropicInstrumentor().instrument(
            llm = DokuConfig.llm,
            environment = DokuConfig.environment,
            application_name = DokuConfig.application_name,
            tracer = tracer,
            pricing_info =  DokuConfig.pricing_info,
        )
        return
    elif isinstance(llm, AsyncAnthropic):
        AsyncAnthropicInstrumentor().instrument(
            llm = DokuConfig.llm,
            environment = DokuConfig.environment,
            application_name = DokuConfig.application_name,
            tracer = tracer,
            pricing_info =  DokuConfig.pricing_info,
        )
        return
    elif hasattr(llm, 'generate') and callable(llm.generate):
        CohereInstrumentor().instrument(
            llm = DokuConfig.llm,
            environment = DokuConfig.environment,
            application_name = DokuConfig.application_name,
            tracer = tracer,
            pricing_info =  DokuConfig.pricing_info,
        )
        return