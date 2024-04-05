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
    - DOKU_URL: Doku URL for monitoring data submission.
    - DOKU_TOKEN: Doku authentication api_key.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
from openai import OpenAI
import openlmt

# Global client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_TOKEN"),
)

# Global initialization
# pylint: disable=line-too-long
openlmt.init(llm=client, doku_url=os.getenv("DOKU_URL"), api_key=os.getenv("DOKU_TOKEN"), environment="dokumetry-testing", application_name="dokumetry-python-test")

def test_completion_with_gpt_3_5_turbo_instruct():
    """
    Test the completion with the GPT-3.5-turbo-instruct model.

    Raises:
        AssertionError: If the completion response object is not as expected.
    """

    completions_resp = client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt="Hello world",
        max_tokens=1
    )
    assert completions_resp.object == 'text_completion'

def test_chat_completion_with_gpt_3_5_turbo():
    """
    Test chat completion with the GPT-3.5-turbo model.

    Raises:
        AssertionError: If the chat completion response object is not as expected.
    """

    chat_completions_resp = client.chat.completions.create(
        model="gpt-3.5-turbo",
        max_tokens=1,
        messages=[{"role": "user", "content": "What is LLM Observability?"}]
    )
    assert chat_completions_resp.object == 'chat.completion'

def test_embedding_creation():
    """
    Test embedding creation.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    embeddings_resp = client.embeddings.create(
        model="text-embedding-ada-002",
        input="The quick brown fox jumped over the lazy dog",
        encoding_format="float"
    )
    assert embeddings_resp.data[0].object == 'embedding'

# def test_fine_tuning_job_creation():
#     """
#     Test fine-tuning job creation.

#     Raises:
#         AssertionError: If the fine-tuning job response object is not as expected.
#     """
#     try:
#         fine_tuning_job_resp = client.fine_tuning.jobs.create(
#             training_file="",
#             model="gpt-3.5-turbo-1106"
#         )
#         assert fine_tuning_job_resp.object == 'fine_tuning.job'

#     #pylint: disable=broad-exception-caught
#     except Exception as e:
#         if 'rate_limit_exceeded' in str(e):
#             error_json = e.response.json()
#             rate_limit_code = error_json['error']['code']
#             print(rate_limit_code)

def test_image_generation():
    """
    Test image generation.

    Raises:
        AssertionError: If the image generation response created timestamp is not present.
    """

    image_generation_resp = client.images.generate(
        model='dall-e-2',
        prompt='Generate an image of a cat.',
        size='256x256',
        n=1
    )
    assert image_generation_resp.created is not None

def test_image_variation_creation():
    """
    Test image variation creation.

    Raises:
        AssertionError: If the image variation response created timestamp is not present.
    """
    # pylint: disable=consider-using-with
    image_variation_resp = client.images.create_variation(
        image=open("tests/test-image-for-openai.png", "rb"),
        n=1,
        size="256x256"
    )
    assert image_variation_resp.created is not None

def test_audio_speech_generation():
    """
    Test audio speech generation.

    Raises:
        AssertionError: If the audio speech response is not present or not an instance of an object.
    """

    audio_speech_resp = client.audio.speech.create(
        model='tts-1',
        voice='alloy',
        input='LLM Observability!')
    assert audio_speech_resp is not None and isinstance(audio_speech_resp, object)
