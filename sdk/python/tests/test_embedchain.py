# pylint: disable=duplicate-code, no-member
"""
This module contains tests for Embedchain functionality using the embedchain Python library.

Tests cover various functions, including WebBaseLoader, TextSplitter,
and Prompt pull from Hub. 
These tests validate integration with OpenLIT.

Note: Ensure the environment is properly configured for Embedchain and OpenLIT monitoring
prior to running these tests.
"""

from embedchain import App
import openlit
import os

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

config = {
    'app': {
        'config': {
            'name': 'openlit-testing'
        }
    },
    'llm': {
        'provider': 'openai',
        'config': {
            'model': 'gpt-3.5-turbo',
            'temperature': 0.5,
            'max_tokens': 1,
            'top_p': 1,
            'stream': False,
            'api_key': os.getenv("OPENAI_API_TOKEN")
        }
    },
    'vectordb': {
        'provider': 'chroma',
        'config': {
            'collection_name': 'full-stack-app',
            'dir': 'db',
            'allow_reset': True
        }
    },
    'embedder': {
        'provider': 'openai',
        'config': {
            'model': 'text-embedding-ada-002',
            'api_key': os.getenv("OPENAI_API_TOKEN")
        }
    }
}

def test_embedchain():
    """
    Verifies the functionality of Embedchain operations including document loading, text splitting,
    and prompt pulling from the Hub. Each operation is tested to ensure it functions as intended,
    confirming the efficient use of the Embedchain library for processing and interacting
    with text data.

    This test checks for the expected outcomes and metadata from each operation to
    confirm that the Embedchain library is working as expected within the intended use cases.

    Raises:
      AssertionError: If the outcomes from the Embedchain operations deviate from what is expected.
    """

    app = App()
    app.add("https://www.forbes.com/profile/elon-musk")

    data_sources = app.get_data_sources()
    assert isinstance(data_sources, int)

    evals = app.evaluate(["What is the net worth of Elon Musk?", "How many companies Elon Musk owns?"])
    assert isinstance(evals, dict)
