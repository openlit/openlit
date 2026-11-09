# pylint: disable=missing-module-docstring, missing-function-docstring, missing-class-docstring, too-few-public-methods
from unittest.mock import MagicMock

import pytest
from openai.types import Image, ImagesResponse

from openlit import OpenlitConfig
from openlit.instrumentation.openai.utils import process_image_response
from openlit.semcov import SemanticConvention


PRICING = {"images": {"dall-e-2": {"standard": {"1024x1024": 0.02}}}}


@pytest.fixture(autouse=True)
def _reset_config():
    OpenlitConfig.reset_to_defaults()


class _Span:
    def __init__(self):
        self.attributes = {}

    def set_attribute(self, key, value):
        self.attributes[key] = value

    def set_status(self, status):
        pass

    def add_event(self, *args, **kwargs):
        pass


def _run(image_count, **kwargs):
    span = _Span()
    metrics = {
        "genai_client_operation_duration": MagicMock(),
        "genai_cost": MagicMock(),
    }
    response = ImagesResponse(
        created=1700000000,
        data=None
        if image_count is None
        else [Image(url=f"https://example.com/{i}.png") for i in range(image_count)],
    )
    process_image_response(
        response=response,
        request_model="dall-e-2",
        pricing_info=PRICING,
        server_port=443,
        server_address="api.openai.com",
        environment="test",
        application_name="test",
        metrics=metrics,
        start_time=0.0,
        end_time=1.0,
        span=span,
        capture_message_content=False,
        disable_metrics=False,
        version="1.0.0",
        model="dall-e-2",
        prompt="a cat",
        **kwargs,
    )
    return span.attributes, metrics["genai_cost"].record.call_args.args[0]


def test_single_image_cost():
    attributes, metric_cost = _run(1)
    assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(0.02)
    assert metric_cost == pytest.approx(0.02)


def test_cost_scales_with_number_of_generated_images():
    attributes, metric_cost = _run(4, n=4)
    assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(0.08)
    assert metric_cost == pytest.approx(0.08)


def test_cost_uses_requested_count_when_response_has_no_data():
    attributes, _ = _run(None, n=3)
    assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(0.06)


def test_empty_response_costs_nothing():
    attributes, _ = _run(0, n=3)
    assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(0.0)
