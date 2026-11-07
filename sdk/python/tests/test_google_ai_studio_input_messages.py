"""
Regression tests: google-genai string contents reach gen_ai.input.messages.

`generate_content(contents="...")` is the documented quickstart form, and the
list form may carry plain strings next to Content objects. Both must become
user text messages instead of being dropped.
"""

from google.genai import types

from openlit.instrumentation.google_ai_studio import utils as google_ai_studio_utils


def _user_text(text):
    return {"role": "user", "parts": [{"type": "text", "content": text}]}


def test_string_contents_become_a_user_message():
    """A plain string prompt is recorded as one user text message."""
    assert google_ai_studio_utils.build_input_messages("Why is the sky blue?") == [
        _user_text("Why is the sky blue?")
    ]


def test_consecutive_strings_become_one_user_message():
    """google-genai sends consecutive strings as the parts of one user message."""
    assert google_ai_studio_utils.build_input_messages(["Why?", "Because."]) == [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "Why?"},
                {"type": "text", "content": "Because."},
            ],
        }
    ]


def test_a_single_content_is_recorded():
    """A Content passed in place of a list is recorded like a one-item list."""
    content = types.Content(role="user", parts=[types.Part(text="Why is the sky blue?")])

    assert google_ai_studio_utils.build_input_messages(content) == [
        _user_text("Why is the sky blue?")
    ]


def test_strings_in_a_contents_list_become_user_messages():
    """Strings in the list are kept, in order, next to Content objects."""
    contents = [
        "Why is the sky blue?",
        types.Content(role="model", parts=[types.Part(text="Rayleigh scattering.")]),
        "And sunsets?",
    ]

    assert google_ai_studio_utils.build_input_messages(
        contents, system_instruction="Be brief."
    ) == [
        {"role": "system", "parts": [{"type": "text", "content": "Be brief."}]},
        _user_text("Why is the sky blue?"),
        {
            "role": "assistant",
            "parts": [{"type": "text", "content": "Rayleigh scattering."}],
        },
        _user_text("And sunsets?"),
    ]
