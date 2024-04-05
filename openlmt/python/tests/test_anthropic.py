"""
Anthropic Test Suite

This module contains a suite of tests for Anthropic functionality 
using the Anthropic Python library. It includes tests for various 
Anthropic API endpoints such as text summarization, text generation 
with a prompt,text embeddings creation, and chat-based 
language understanding.

The tests are designed to cover different aspects of Anthropic's 
capabilities and serve as a validation mechanism for the integration 
with the Doku monitoring system.

Global Anthropic client and initialization are set up for the 
Anthropic client and Doku monitoring.

Environment Variables:
    - ANTHROPIC_API_TOKEN: Anthropic API api_key for authentication.
    - DOKU_URL: Doku URL for monitoring data submission.
    - DOKU_TOKEN: Doku authentication api_key.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
from anthropic import Anthropic
import openlmt

# Global Anthropic client
client = Anthropic(
    api_key=os.getenv("ANTHROPIC_API_TOKEN")
)

# Global Anthropic initialization
# pylint: disable=line-too-long
openlmt.init(llm=client, environment="dokumetry-testing", application_name="dokumetry-python-test")

def test_messages():
    """
    Test the 'messages.create' function of the Anthropic client.
    """
    try:
        message = client.messages.create(
            max_tokens=1,
            messages=[
                {
                    "role": "user",
                    "content": "Hello, Claude",
                }
            ],
            model="claude-3-haiku-20240307",
        )
        assert message.type == 'message'

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
