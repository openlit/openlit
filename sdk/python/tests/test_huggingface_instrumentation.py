# pylint: disable=duplicate-code, no-name-in-module, import-error
"""
This module contains tests for HuggingFace Hub functionality using the HuggingFace Hub Python library.

Tests cover various API endpoints.
These tests validate integration with OpenLIT.

Note: Ensure the environment is properly configured for HuggingFace Hub access and OpenLIT monitoring
prior to running these tests.
"""

import huggingface_hub
import openlit

# Initialize environment and application name for OpenLIT monitoring
openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-huggingfacehub-test",
)


def test_huggingface_list_models():
    # Only get the first model to avoid long network calls
    model_name = "gpt-oss"
    models_iterable = huggingface_hub.list_models(filter=model_name)
    assert models_iterable is not None
    assert hasattr(models_iterable, "__iter__")
    
    # Shorter way to check if models exist
    model = next(iter(models_iterable), None)
    assert model is not None, f"No models found with filter '{model_name}'"
    
    assert hasattr(model, "id")
    assert isinstance(model.id, str)
    assert len(model.id) > 0
