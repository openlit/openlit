"""Tests for CLI --no_capture_message_content negation flag (issue #1962)."""

import os
import sys

import pytest

from openlit.cli.main import parse_arguments, set_environment_from_cli_args

ENV_VAR = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"


class TestNegationFlagParsing:
    """parse_arguments() must accept --no_capture_message_content."""

    def test_negative_flag_accepted(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "--no_capture_message_content", "python", "app.py"],
        )
        args, cmd = parse_arguments()
        assert args.capture_message_content is False
        assert cmd == ["python", "app.py"]

    def test_positive_flag_accepted(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "--capture_message_content", "python", "app.py"],
        )
        args, _ = parse_arguments()
        assert args.capture_message_content is True

    def test_no_flag_gives_none(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "python", "app.py"],
        )
        args, _ = parse_arguments()
        assert args.capture_message_content is None

    def test_both_flags_rejected(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            [
                "openlit-instrument",
                "--capture_message_content",
                "--no_capture_message_content",
                "python", "app.py",
            ],
        )
        with pytest.raises(SystemExit) as exc_info:
            parse_arguments()
        assert exc_info.value.code == 2


class TestNegationFlagEnvExport:
    """set_environment_from_cli_args() must export the correct value."""

    def test_negative_flag_exports_false(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "--no_capture_message_content", "python", "app.py"],
        )
        monkeypatch.delenv(ENV_VAR, raising=False)
        args, _ = parse_arguments()
        set_environment_from_cli_args(args)
        assert os.environ.get(ENV_VAR) == "false"

    def test_positive_flag_exports_true(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "--capture_message_content", "python", "app.py"],
        )
        monkeypatch.delenv(ENV_VAR, raising=False)
        args, _ = parse_arguments()
        set_environment_from_cli_args(args)
        assert os.environ.get(ENV_VAR) == "true"

    def test_no_flag_does_not_set_env_var(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "python", "app.py"],
        )
        monkeypatch.delenv(ENV_VAR, raising=False)
        args, _ = parse_arguments()
        set_environment_from_cli_args(args)
        assert os.environ.get(ENV_VAR) is None

    def test_env_var_takes_precedence_over_negative_flag(self, monkeypatch):
        monkeypatch.setattr(
            sys, "argv",
            ["openlit-instrument", "--no_capture_message_content", "python", "app.py"],
        )
        monkeypatch.setenv(ENV_VAR, "true")
        args, _ = parse_arguments()
        set_environment_from_cli_args(args)
        assert os.environ.get(ENV_VAR) == "true"
