"""Tests for openlit-instrument CLI boolean flag parsing and env propagation."""

import os

from openlit.cli.main import parse_arguments, set_environment_from_cli_args

CAPTURE_ENV_VAR = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"


def parse(monkeypatch, argv):
    monkeypatch.setattr("sys.argv", ["openlit-instrument"] + argv)
    return parse_arguments()


class TestBooleanFlags:
    def test_negation_flag_parses_false(self, monkeypatch):
        """--no_capture_message_content must parse instead of erroring."""
        args, command = parse(
            monkeypatch, ["--no_capture_message_content", "python", "app.py"]
        )
        assert args.capture_message_content is False
        assert command == ["python", "app.py"]

    def test_positive_flag_parses_true(self, monkeypatch):
        args, _ = parse(monkeypatch, ["--capture_message_content", "python", "app.py"])
        assert args.capture_message_content is True

    def test_omitted_flag_stays_none(self, monkeypatch):
        """An unset boolean flag must be distinguishable from an explicit False."""
        args, _ = parse(monkeypatch, ["python", "app.py"])
        assert args.capture_message_content is None
        assert args.disable_batch is None

    def test_explicit_false_is_exported(self, monkeypatch):
        monkeypatch.delenv(CAPTURE_ENV_VAR, raising=False)
        args, _ = parse(
            monkeypatch, ["--no_capture_message_content", "python", "app.py"]
        )
        set_environment_from_cli_args(args)
        assert os.environ[CAPTURE_ENV_VAR] == "false"
        monkeypatch.delenv(CAPTURE_ENV_VAR, raising=False)

    def test_omitted_flag_exports_nothing(self, monkeypatch):
        monkeypatch.delenv("OPENLIT_DISABLE_BATCH", raising=False)
        args, _ = parse(monkeypatch, ["python", "app.py"])
        set_environment_from_cli_args(args)
        assert "OPENLIT_DISABLE_BATCH" not in os.environ

    def test_env_var_takes_precedence_over_cli(self, monkeypatch):
        monkeypatch.setenv(CAPTURE_ENV_VAR, "true")
        args, _ = parse(
            monkeypatch, ["--no_capture_message_content", "python", "app.py"]
        )
        set_environment_from_cli_args(args)
        assert os.environ[CAPTURE_ENV_VAR] == "true"
