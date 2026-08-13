# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Groq functionality using the Groq Python library.

Tests cover various API endpoints, including chat.
These tests validate integration with OpenLIT.

Environment Variables:
    - GROQ_API_TOKEN: Groq API api_key for authentication.

Note: Ensure the environment is properly configured for Groq access and OpenLIT monitoring
prior to running these tests.
"""

import os
import pytest
from groq import Groq, AsyncGroq
import openlit

# Initialize synchronous Groq client
sync_client = Groq(api_key=os.getenv("GROQ_API_TOKEN"))

# Initialize asynchronous Groq client
async_client = AsyncGroq(api_key=os.getenv("GROQ_API_TOKEN"))

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")


def test_sync_groq_chat():
    """
    Tests synchronous Chat Completions.

    Raises:
        AssertionError: If the Chat Completions response object is not as expected.
    """

    try:
        chat_completions_resp = sync_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": "Monitor LLM Applications",
                }
            ],
            model="llama-3.1-8b-instant",
            max_tokens=1,
            stream=False,
        )
        assert chat_completions_resp.object == "chat.completion"

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_groq_chat():
    """
    Tests synchronous Chat Completions with the 'claude-3-haiku-20240307' model.

    Raises:
        AssertionError: If the Chat Completions response object is not as expected.
    """

    try:
        chat_completions_resp = await async_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": "What is LLM Observability?",
                }
            ],
            model="llama-3.1-8b-instant",
            max_tokens=1,
            stream=False,
        )
        assert chat_completions_resp.object == "chat.completion"

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


def _sample_audio_file():
    """
    Generates a small in-memory WAV file for speech-to-text tests.
    """

    import io
    import struct
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(struct.pack("<h", 0) * 16000)
    buffer.seek(0)
    return ("sample.wav", buffer)


def test_sync_groq_transcription():
    """
    Tests synchronous Audio Transcriptions.

    Raises:
        AssertionError: If the Audio Transcriptions response object is not as expected.
    """

    try:
        transcription_resp = sync_client.audio.transcriptions.create(
            file=_sample_audio_file(),
            model="whisper-large-v3",
        )
        assert isinstance(transcription_resp.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


def test_sync_groq_translation():
    """
    Tests synchronous Audio Translations.

    Raises:
        AssertionError: If the Audio Translations response object is not as expected.
    """

    try:
        translation_resp = sync_client.audio.translations.create(
            file=_sample_audio_file(),
            model="whisper-large-v3",
        )
        assert isinstance(translation_resp.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


def test_sync_groq_speech():
    """
    Tests synchronous Audio Speech (text-to-speech).

    Raises:
        AssertionError: If the Audio Speech response object is not as expected.
    """

    try:
        speech_resp = sync_client.audio.speech.create(
            model="canopylabs/orpheus-v1-english",
            voice="troy",
            input="Monitor LLM Applications",
            response_format="wav",
        )
        assert speech_resp.read()

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower() or "terms acceptance" in str(e).lower():
            print("Skipped:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_groq_transcription():
    """
    Tests asynchronous Audio Transcriptions.

    Raises:
        AssertionError: If the Audio Transcriptions response object is not as expected.
    """

    try:
        transcription_resp = await async_client.audio.transcriptions.create(
            file=_sample_audio_file(),
            model="whisper-large-v3",
        )
        assert isinstance(transcription_resp.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_groq_translation():
    """
    Tests asynchronous Audio Translations.

    Raises:
        AssertionError: If the Audio Translations response object is not as expected.
    """

    try:
        translation_resp = await async_client.audio.translations.create(
            file=_sample_audio_file(),
            model="whisper-large-v3",
        )
        assert isinstance(translation_resp.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_groq_speech():
    """
    Tests asynchronous Audio Speech (text-to-speech).

    Raises:
        AssertionError: If the Audio Speech response object is not as expected.
    """

    try:
        speech_resp = await async_client.audio.speech.create(
            model="canopylabs/orpheus-v1-english",
            voice="troy",
            input="Monitor LLM Applications",
            response_format="wav",
        )
        assert await speech_resp.read()

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower() or "terms acceptance" in str(e).lower():
            print("Skipped:", e)
        else:
            raise
