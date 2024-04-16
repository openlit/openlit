# pylint: disable=duplicate-code
"""
OpenAI Test Suite

This module contains a suite of tests for OpenAI functionality using the OpenAI Python library.
It includes tests for various OpenAI API endpoints such as completions, chat completions,
embeddings creation, fine-tuning job creation, image generation, image variation creation,
and audio speech generation.

The tests are designed to cover different aspects of OpenAI's capabilities and serve as a
validation mechanism for the integration with the Doku monitoring system.

Global client and initialization are set up for the OpenAI client and Doku monitoring.

Environment Variables:
    - OPENAI_API_TOKEN: OpenAI API key for authentication.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
from openai import OpenAI, AsyncOpenAI
import openlit
import asyncio

# Global sync client
sync_client = OpenAI(
    api_key=os.getenv("OPENAI_API_TOKEN"),
)

# Global async client
async_client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_TOKEN"),
)

# Global initialization
# pylint: disable=line-too-long
openlit.init(environment="dokumetry-testing", application_name="dokumetry-python-test")

def test_sync_openai_chat_completions():
    """
    Test chat completion with the 'gpt-3.5-turbo' model.

    Raises:
        AssertionError: If the chat completion response object is not as expected.
    """

    chat_completions_resp = sync_client.chat.completions.create(
        model="gpt-3.5-turbo",
        max_tokens=1,
        messages=[{"role": "user", "content": "What is LLM Observability?"}]
    )
    assert chat_completions_resp.object == 'chat.completion'

def test_sync_openai_embeddings():
    """
    Test embedding creation with the 'text-embedding-ada-002' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    embeddings_resp = sync_client.embeddings.create(
        model="text-embedding-ada-002",
        input="The quick brown fox jumped over the lazy dog",
        encoding_format="float"
    )
    assert embeddings_resp.data[0].object == 'embedding'

# def test_sync_openai_fine_tuning_job_creation():
#     """
#     Test fine-tuning job creation.

#     Raises:
#         AssertionError: If the fine-tuning job response object is not as expected.
#     """
#     try:
#         fine_tuning_job_resp = sync_client.fine_tuning.jobs.create(
#             training_file="",
#             model="gpt-3.5-turbo-1106"
#         )
#         assert fine_tuning_job_resp.object == 'fine_tuning.job'

#     # pylint: disable=broad-exception-caught
#     except Exception as e:
#         if 'rate_limit_exceeded' in str(e):
#             error_json = e.response.json()
#             rate_limit_code = error_json['error']['code']
#             print(rate_limit_code)

def test_sync_openai_image_generation():
    """
    Test image generation with 'dall-e-2' model.

    Raises:
        AssertionError: If the image generation response created timestamp is not present.
    """

    image_generation_resp = sync_client.images.generate(
        model='dall-e-2',
        prompt='Generate an image of a cat.',
        size='256x256',
        n=1
    )
    assert image_generation_resp.created is not None

def test_sync_openai_image_variations():
    """
    Test image variation creation with 'dall-e-2' model.

    Raises:
        AssertionError: If the image variation response created timestamp is not present.
    """

    image_variation_resp = sync_client.images.create_variation(
        image=open("tests/test-image-for-openai.png", "rb"),
        model='dall-e-2',
        n=1,
        size="256x256"
    )
    assert image_variation_resp.created is not None

def test_sync_openai_audio_speech_create():
    """
    Test audio speech generation with 'tts-1' model.

    Raises:
        AssertionError: If the audio speech response is not present or not an instance of an object.
    """

    audio_speech_resp = sync_client.audio.speech.create(
        model='tts-1',
        voice='alloy',
        input='LLM Observability!')
    assert audio_speech_resp is not None and isinstance(audio_speech_resp, object)

def test_async_openai_chat_completions():
    """
    Test chat completion with the 'gpt-3.5-turbo' model.

    Raises:
        AssertionError: If the chat completion response object is not as expected.
    """
    async def main() -> None:
        chat_completions_resp = async_client.chat.completions.create(
            model="gpt-3.5-turbo",
            max_tokens=1,
            messages=[{"role": "user", "content": "What is LLM Observability?"}]
        )
        assert chat_completions_resp.object == 'chat.completion'
    asyncio.run(main())

def test_async_openai_embeddings():
    """
    Test embedding creation with the 'text-embedding-ada-002' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    async def main() -> None:
        embeddings_resp = async_client.embeddings.create(
            model="text-embedding-ada-002",
            input="The quick brown fox jumped over the lazy dog",
            encoding_format="float"
        )
        assert embeddings_resp.data[0].object == 'embedding'
    asyncio.run(main())