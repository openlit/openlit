"""Tests for the PII guard."""

import pytest

from openlit.guard.pii import PII
from openlit.guard._base import GuardAction

KEY_BODY = "MIIEowIBAAKCAQEAxg7a2n3V5h8mQ0\n9fKq+/Zt4b1c6d7e8f9g0h1i2j3k4l\nAbCd=="


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

    @pytest.mark.parametrize(
        "email",
        [
            "user@example.co.uk",
            "user@mail.example.com",
            "user@cs.dept.example.edu",
        ],
    )
    def test_email_with_subdomain_redacted_completely(self, email):
        """No part of a domain with more than two labels is left behind."""
        guard = PII(action="redact")
        result = guard.evaluate(f"Email: {email}, thanks")
        assert result.transformed_text == "Email: [REDACTED:email], thanks"

    def test_email_at_end_of_sentence_keeps_period(self):
        """The period that ends a sentence is not part of the address."""
        guard = PII(action="redact")
        result = guard.evaluate("Write to user@example.co.uk. Thanks")
        assert result.transformed_text == "Write to [REDACTED:email]. Thanks"

    @pytest.mark.parametrize(
        "number", ["378282246310005", "3782 822463 10005", "3714-496353-98431"]
    )
    def test_amex_redacted(self, number):
        """American Express numbers have 15 digits, grouped 4-6-5."""
        guard = PII(action="redact")
        result = guard.evaluate(f"Card: {number}.")
        assert result.transformed_text == "Card: [REDACTED:credit-card]."

    @pytest.mark.parametrize("separator", ["\n", "\\n", "\r\n"])
    @pytest.mark.parametrize("kind", ["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED "])
    def test_private_key_block_redacted_completely(self, kind, separator):
        """The key itself is redacted, not just the header."""
        guard = PII(action="redact")
        key = (
            f"-----BEGIN {kind}PRIVATE KEY-----\n{KEY_BODY}\n"
            f"-----END {kind}PRIVATE KEY-----"
        ).replace("\n", separator)
        result = guard.evaluate(f"before {key} after")
        assert result.transformed_text == "before [REDACTED:private-key] after"

    def test_private_key_with_headers_redacted_completely(self):
        """Headers of an encrypted PEM block contain dashes."""
        guard = PII(action="redact")
        result = guard.evaluate(
            "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n"
            f"DEK-Info: AES-128-CBC,0A1B2C\n\n{KEY_BODY}\n"
            "-----END RSA PRIVATE KEY-----"
        )
        assert result.transformed_text == "[REDACTED:private-key]"

    def test_pgp_private_key_block_redacted_completely(self):
        """PGP blocks end with 'KEY BLOCK'."""
        guard = PII(action="redact")
        result = guard.evaluate(
            f"-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n{KEY_BODY}\n"
            "-----END PGP PRIVATE KEY BLOCK-----"
        )
        assert result.transformed_text == "[REDACTED:private-key]"

    def test_private_key_without_footer_redacted(self):
        """A key that is cut off is redacted up to the last full line."""
        guard = PII(action="redact")
        body = KEY_BODY.rsplit("\n", 1)[0]
        result = guard.evaluate(f"-----BEGIN PRIVATE KEY-----\n{body}")
        assert result.transformed_text == "[REDACTED:private-key]"

    @pytest.mark.parametrize("prefix", ["-", "+", "> "])
    def test_private_key_in_a_diff_or_quote_redacted(self, prefix):
        """A prefix on every line does not hide the key."""
        guard = PII(action="redact")
        lines = [
            "-----BEGIN RSA PRIVATE KEY-----",
            *KEY_BODY.split("\n"),
            "-----END RSA PRIVATE KEY-----",
        ]
        result = guard.evaluate("\n".join(prefix + line for line in lines))
        assert result.transformed_text == prefix + "[REDACTED:private-key]"
        result = guard.evaluate("\n".join(prefix + line for line in lines[:-2]))
        assert result.transformed_text == prefix + "[REDACTED:private-key]"

    def test_private_key_with_headers_and_without_footer_redacted(self):
        """The headers of a cut off key do not stop the match."""
        guard = PII(action="redact")
        body = KEY_BODY.rsplit("\n", 1)[0]
        result = guard.evaluate(
            "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n"
            f"DEK-Info: AES-128-CBC,0A1B2C\n\n{body}"
        )
        assert result.transformed_text == "[REDACTED:private-key]"

    def test_two_private_keys_keep_text_between(self):
        """Text between two blocks is kept."""
        guard = PII(action="redact")
        key = f"-----BEGIN PRIVATE KEY-----\n{KEY_BODY}\n-----END PRIVATE KEY-----"
        result = guard.evaluate(f"{key} and {key}")
        assert (
            result.transformed_text
            == "[REDACTED:private-key] and [REDACTED:private-key]"
        )

    def test_private_key_header_in_prose_keeps_text(self):
        """A header that is only mentioned does not remove the text after it."""
        guard = PII(action="redact")
        result = guard.evaluate("It starts with -----BEGIN PRIVATE KEY----- in PEM.")
        assert (
            result.transformed_text == "It starts with [REDACTED:private-key] in PEM."
        )

    def test_overlapping_spans_redacted_cleanly(self):
        """Overlapping matches (env-secret covering an API key) redact as one span."""
        guard = PII(action="redact")
        result = guard.evaluate("config: api_key=sk-proj-abcdefghij1234567890 done")
        assert result.transformed_text == "config: [REDACTED:env-secret] done"

    def test_overlapping_spans_leave_no_secret_tail(self):
        """An inner match must not leave the tail of the value in the output."""
        guard = PII(action="redact")
        result = guard.evaluate("token=1.1.1.1secretos")
        assert result.transformed_text == "[REDACTED:env-secret]"
        assert "secretos" not in result.transformed_text

    def test_disjoint_spans_still_redact_separately(self):
        """Non-overlapping matches keep their own placeholders."""
        guard = PII(action="redact")
        result = guard.evaluate("contact bob@example.com or call 415-555-0100")
        assert (
            result.transformed_text
            == "contact [REDACTED:email] or call [REDACTED:phone-us]"
        )

    def test_adjacent_spans_still_redact_separately(self):
        """Touching but non-overlapping matches are not merged into one span."""
        guard = PII(action="redact")
        result = guard.evaluate("SK" + "a" * 32 + "github_pat_" + "b" * 22)
        assert (
            result.transformed_text
            == "[REDACTED:twilio-api-key][REDACTED:github-fine-grained]"
        )


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
