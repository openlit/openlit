# pylint: disable=duplicate-code, no-name-in-module, import-error
"""
This module contains tests for ElevenLabs functionality using the ElevenLabs Python library.

Tests cover various API endpoints, including chat. 
These tests validate integration with OpenLIT.

Environment Variables:
    - ELEVENLABS_API_TOKEN: GroElevenLabsq API api_key for authentication.

Note: Ensure the environment is properly configured for ElevenLabs access and OpenLIT monitoring
prior to running these tests.
"""

import os
import types
import pytest
from elevenlabs.client import ElevenLabs, AsyncElevenLabs
import openlit

# Initialize synchronous ElevenLabs client
sync_client = ElevenLabs(
  api_key=os.getenv("ELEVENLABS_API_TOKEN")
)

async_client = AsyncElevenLabs(
  api_key=os.getenv("ELEVENLABS_API_TOKEN")
)

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_sync_elevenlabs_generate():
    """
    Tests synchronous generate text-to-speech with the 'eleven_multilingual_v2' model.

    Raises:
        AssertionError: If the generate text-to-speech response object is not as expected.
    """

    try:
        audio = sync_client.generate(
            text="Say LLM Monitoring",
            voice="Rachel",
            model="eleven_multilingual_v2"
        )
        assert isinstance(audio, types.GeneratorType)

        audio = sync_client.generate(
            text="Say LLM Observability!",
            voice="Rachel",
            model="eleven_multilingual_v2",
            stream=True
        )
        assert isinstance(audio, types.GeneratorType)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise

@pytest.mark.asyncio
async def test_async_elevenlabs_generate():
    """
    Tests synchronous generate text-to-speech with the 'eleven_multilingual_v2' model.

    Raises:
        AssertionError: If the generate text-to-speech response object is not as expected.
    """

    try:
        audio = await async_client.generate(
            text="Say LLM Monitoring",
            voice="Rachel",
            model="eleven_multilingual_v2"
        )
        assert isinstance(audio, types.AsyncGeneratorType)

        audio = await async_client.generate(
            text="Say LLM Observability!",
            voice="Rachel",
            model="eleven_multilingual_v2",
            stream=True
        )
        assert isinstance(audio, types.AsyncGeneratorType)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise
