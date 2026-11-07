"""Tests for openlit.__helpers.general_tokens."""

from openlit.__helpers import general_tokens


class TestGeneralTokens:
    def test_none_returns_zero(self):
        """None input should return 0, not raise TypeError."""
        assert general_tokens(None) == 0

    def test_empty_string(self):
        assert general_tokens("") == 0

    def test_single_char(self):
        assert general_tokens("a") == 1

    def test_short_string(self):
        assert general_tokens("hello") == 3  # ceil(5/2)

    def test_even_length(self):
        assert general_tokens("abcd") == 2  # ceil(4/2)

    def test_odd_length(self):
        assert general_tokens("abc") == 2  # ceil(3/2)

    def test_long_string(self):
        text = "x" * 100
        assert general_tokens(text) == 50
