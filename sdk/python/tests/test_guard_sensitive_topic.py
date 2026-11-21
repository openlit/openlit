"""Tests for the SensitiveTopic guard."""

from openlit.guard._base import GuardAction
from openlit.guard.sensitive_topic import SensitiveTopic, _DEFAULT_CATEGORIES


class TestSensitiveTopicBasics:
    """Core detection behaviour."""

    def test_detects_builtin_category(self):
        """A built-in category pattern triggers the configured action."""
        guard = SensitiveTopic()
        result = guard.evaluate("the coup happened yesterday")
        assert result.action == GuardAction.WARN
        assert "politics" in result.classification

    def test_clean_text_allows(self):
        """Clean text always allows."""
        guard = SensitiveTopic()
        result = guard.evaluate("the weather is nice today")
        assert result.action == GuardAction.ALLOW

    def test_custom_category_detects(self):
        """A custom category pattern is detected on the instance that defines it."""
        guard = SensitiveTopic(
            custom_categories={"medical": [r"prescription\s+number"]}
        )
        result = guard.evaluate("my prescription number is 123")
        assert result.action == GuardAction.WARN
        assert "medical" in result.classification


class TestSensitiveTopicPatternIsolation:
    """Custom categories must not mutate the shared module-level defaults."""

    def test_custom_patterns_do_not_leak_into_default_categories(self):
        """Custom patterns for a built-in category stay on this instance.

        ``_DEFAULT_CATEGORIES`` is module-level state shared by every
        SensitiveTopic.  A guard that extends it from ``custom_categories``
        would change every other guard in the process.
        """
        before = list(_DEFAULT_CATEGORIES["politics"])
        SensitiveTopic(custom_categories={"politics": [r"ballot_harvest_marker"]})
        after = list(_DEFAULT_CATEGORIES["politics"])
        assert before == after

        fresh = SensitiveTopic()
        result = fresh.evaluate("we did ballot_harvest_marker yesterday")
        assert result.action == GuardAction.ALLOW

    def test_own_custom_pattern_still_detected(self):
        """The defining instance still detects its own custom pattern."""
        guard = SensitiveTopic(custom_categories={"politics": [r"ballot_harvest_marker"]})
        result = guard.evaluate("we did ballot_harvest_marker yesterday")
        assert result.action == GuardAction.WARN
        assert "politics" in result.classification
