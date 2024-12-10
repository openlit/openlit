# pylint: disable=duplicate-code, no-name-in-module, import-error
"""
This module contains tests for FireCrawl functionality using the FireCrawl Python library.

Tests cover various API endpoints, including chat and embeddings. 
These tests validate integration with OpenLIT.

Environment Variables:
    - FIRECRAWL_API_KEY: FireCrawl API key for authentication.

Note: Ensure the environment is properly configured for FireCrawl access and OpenLIT monitoring
prior to running these tests.
"""

import os
from firecrawl import FirecrawlApp
import openlit

# Initialize synchronous FireCrawl client
sync_client = FirecrawlApp(api_key=os.getenv("FIRECRAWL_API_KEY"))

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-python-testing", application_name="openlit-python-firecrawl-test")

def test_sync_scarpe_url():
    """
    Tests synchronous scrape url.

    Raises:
        AssertionError: If the response object is not as expected.
    """

    response = sync_client.scrape_url(
        'https://openlit.io', 
        params={'formats': ['markdown', 'html'],}
    )

    assert isinstance(response, dict)
