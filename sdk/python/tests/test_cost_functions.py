"""Tests for openlit.__helpers audio/image cost functions."""

from openlit.__helpers import get_audio_model_cost, get_image_model_cost


PRICING = {
    "audio": {"whisper": 0.006},
    "images": {"dall-e-3": {"standard": {"1024x1024": 0.04}}},
}


class TestGetAudioModelCost:
    def test_normal_prompt(self):
        cost = get_audio_model_cost("whisper", PRICING, "hello world", None)
        assert cost == (11 / 1000) * 0.006

    def test_none_prompt_none_duration(self):
        """None prompt + None duration should return 0, not crash."""
        assert get_audio_model_cost("whisper", PRICING, None, None) == 0

    def test_empty_prompt_none_duration(self):
        assert get_audio_model_cost("whisper", PRICING, "", None) == 0

    def test_duration_only(self):
        cost = get_audio_model_cost("whisper", PRICING, None, 10)
        assert cost == 10 * 0.006

    def test_missing_model(self):
        assert get_audio_model_cost("unknown", PRICING, "hello", None) == 0


class TestGetImageModelCost:
    def test_normal(self):
        assert get_image_model_cost("dall-e-3", PRICING, "1024x1024", "standard") == 0.04

    def test_missing_model(self):
        assert get_image_model_cost("unknown", PRICING, "1024x1024", "standard") == 0
