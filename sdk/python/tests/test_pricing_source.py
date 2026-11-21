"""Pricing JSON sources use local file I/O for Windows paths."""

import json
from unittest.mock import Mock, mock_open, patch

import pytest

from openlit.__helpers import fetch_pricing_info

PRICING = {"chat": {"custom-model": {"promptPrice": 0.1, "completionPrice": 0.2}}}


@pytest.mark.parametrize(
    "path", [r"C:\custom\pricing.json", "C:/custom/pricing.json", r"d:\pricing.json"]
)
def test_windows_drive_path_is_read_as_a_file(path):
    """Drive letters must not select the HTTP client."""
    opener = mock_open(read_data=json.dumps(PRICING))
    with patch("builtins.open", opener), patch("openlit.__helpers.requests.get") as get:
        assert fetch_pricing_info(path) == PRICING
    opener.assert_called_once_with(path, mode="r", encoding="utf-8")
    get.assert_not_called()


def test_relative_file_is_read(tmp_path):
    """Regular local files still load their prices."""
    path = tmp_path / "pricing.json"
    path.write_text(json.dumps(PRICING), encoding="utf-8")
    assert fetch_pricing_info(str(path)) == PRICING


@pytest.mark.parametrize(
    "url", ["http://localhost/pricing.json", "https://example.com/pricing.json"]
)
def test_http_source_is_fetched(url):
    """HTTP and HTTPS sources still use requests."""
    response = Mock()
    response.json.return_value = PRICING
    with patch("openlit.__helpers.requests.get", return_value=response) as get:
        assert fetch_pricing_info(url) == PRICING
    get.assert_called_once_with(url, timeout=20)
    response.raise_for_status.assert_called_once_with()
