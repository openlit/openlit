"""Tests for the PII guard."""

from openlit.guard.pii import PII
from openlit.guard._base import GuardAction


class TestPIIDetection:
    """Detection behaviour for the built-in PII / secret patterns."""

    def test_clean_text_passes(self):
        """Clean text yields an ALLOW action."""
        guard = PII(action="deny")
        result = guard.evaluate("Hello, how are you today?")
        assert result.action == GuardAction.ALLOW

    def test_email_detected(self):
        """An email address triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Contact me at user@example.com please")
        assert result.action == GuardAction.DENY
        assert "email" in result.classification

    def test_ssn_detected(self):
        """A US SSN triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("My SSN is 123-45-6789")
        assert result.action == GuardAction.DENY
        assert "ssn" in result.classification

    def test_credit_card_detected(self):
        """A credit-card number triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Card: 4111-1111-1111-1111")
        assert result.action == GuardAction.DENY
        assert "credit-card" in result.classification

    def test_openai_key_detected(self):
        """An OpenAI-style API key triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Use this key: sk-proj-abcdefghijklmnopqrstuvwxyz")
        assert result.action == GuardAction.DENY
        assert "openai-api-key" in result.classification

    def test_github_token_detected(self):
        """A GitHub personal-access token triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl")
        assert result.action == GuardAction.DENY
        assert "github-token" in result.classification

    def test_aws_key_detected(self):
        """An AWS access key triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("AWS key: AKIAIOSFODNN7EXAMPLE")
        assert result.action == GuardAction.DENY
        assert "aws-access-key" in result.classification

    def test_private_key_detected(self):
        """A PEM private-key header triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("-----BEGIN RSA PRIVATE KEY----- MIIEow...")
        assert result.action == GuardAction.DENY
        assert "private-key" in result.classification

    def test_connection_string_detected(self):
        """A database connection string triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("DB: postgres://user:pass@host:5432/db")
        assert result.action == GuardAction.DENY
        assert "connection-string" in result.classification

    def test_bearer_token_detected(self):
        """A Bearer authorization header triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig")
        assert result.action == GuardAction.DENY
        assert "bearer-token" in result.classification

    def test_phone_detected(self):
        """A US phone number triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Call me at (555) 123-4567")
        assert result.action == GuardAction.DENY
        assert "phone-us" in result.classification

    def test_ip_address_detected(self):
        """An IPv4 address triggers the configured deny action."""
        guard = PII(action="deny")
        result = guard.evaluate("Server IP: 192.168.1.100")
        assert result.action == GuardAction.DENY
        assert "ipv4" in result.classification


class TestPIIRedaction:
    """Redaction behaviour replaces matches with ``[REDACTED:<label>]``."""

    def test_email_redacted(self):
        """An email is replaced by ``[REDACTED:email]``."""
        guard = PII(action="redact")
        result = guard.evaluate("Email: user@example.com")
        assert result.action == GuardAction.REDACT
        assert "[REDACTED:email]" in result.transformed_text
        assert "user@example.com" not in result.transformed_text

    def test_ssn_redacted(self):
        """An SSN is replaced by ``[REDACTED:ssn]``."""
        guard = PII(action="redact")
        result = guard.evaluate("SSN: 123-45-6789")
        assert result.action == GuardAction.REDACT
        assert "[REDACTED:ssn]" in result.transformed_text

    def test_multiple_pii_redacted(self):
        """Multiple PII values in one text are all redacted."""
        guard = PII(action="redact")
        text = "Email: a@b.com, SSN: 111-22-3333"
        result = guard.evaluate(text)
        assert "[REDACTED:email]" in result.transformed_text
        assert "[REDACTED:ssn]" in result.transformed_text
        assert "a@b.com" not in result.transformed_text
        assert "111-22-3333" not in result.transformed_text


class TestPIIWarn:  # pylint: disable=too-few-public-methods
    """``warn`` action emits an event without transforming the text."""

    def test_warn_does_not_transform(self):
        """``warn`` returns transformed_text=None."""
        guard = PII(action="warn")
        result = guard.evaluate("My email is user@example.com")
        assert result.action == GuardAction.WARN
        assert result.transformed_text is None


class TestPIICustomPatterns:  # pylint: disable=too-few-public-methods
    """User-supplied custom regex patterns are honoured."""

    def test_custom_pattern(self):
        """A custom ``internal-id`` pattern is detected."""
        guard = PII(action="deny", custom_patterns={"internal-id": r"INT-\d{6}"})
        result = guard.evaluate("Reference: INT-123456")
        assert result.action == GuardAction.DENY
        assert "internal-id" in result.classification
