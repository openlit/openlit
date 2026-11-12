# pylint: disable=missing-module-docstring, missing-function-docstring
import json
from pathlib import Path

import pytest

from openlit.__helpers import get_image_model_cost


PRICING_JSON = Path(__file__).resolve().parents[3] / "assets" / "pricing.json"


@pytest.mark.parametrize("model", ["dall-e-3", "azure_dall-e-3"])
@pytest.mark.parametrize(
    "quality, size, price",
    [
        ("standard", "1024x1024", 0.04),
        ("standard", "1024x1792", 0.08),
        ("standard", "1792x1024", 0.08),
        ("hd", "1024x1024", 0.08),
        ("hd", "1024x1792", 0.12),
        ("hd", "1792x1024", 0.12),
    ],
)
def test_dall_e_3_image_prices(model, quality, size, price):
    pricing = json.loads(PRICING_JSON.read_text(encoding="utf-8"))
    assert get_image_model_cost(model, pricing, size, quality) == pytest.approx(price)
