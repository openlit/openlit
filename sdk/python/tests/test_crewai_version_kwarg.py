from unittest.mock import MagicMock
from openlit.instrumentation.crewai.utils import process_crewai_response
from openlit.instrumentation.crewai.crewai import general_wrap

from openlit._config import OpenlitConfig

OpenlitConfig.reset_to_defaults()

def test_process_crewai_response_with_version_in_kwargs():
    """Verify process_crewai_response handles tools/calls that have 'version' in kwargs."""
    span = MagicMock()
    response = "tool output result"
    instance = MagicMock()
    instance.name = "TestTool"

    res = process_crewai_response(
        response=response,
        operation_type="execute_tool",
        server_address="localhost",
        server_port=8080,
        environment="test",
        application_name="test-app",
        metrics={},
        start_time=1000.0,
        span=span,
        capture_message_content=True,
        disable_metrics=True,
        version="1.45.0",
        instance=instance,
        args=(),
        endpoint="tool_run",
        kwargs={"path": "README.md", "version": "refs/heads/main"},
    )
    assert res == response
    span.set_status.assert_called()

def test_general_wrap_forwards_version_kwarg_without_error():
    """Verify general_wrap executes wrapped function and records telemetry when kwargs contains version."""
    mock_fn = MagicMock(return_value="executed successfully")
    wrapper = general_wrap(
        gen_ai_endpoint="tool_run",
        version="1.45.0",
        environment="test",
        application_name="test-app",
        tracer=MagicMock(),
        pricing_info={},
        capture_message_content=True,
        metrics={},
        disable_metrics=True,
    )
    instance = MagicMock()
    instance.name = "TestTool"

    res = wrapper(mock_fn, instance, (), {"path": "README.md", "version": "refs/heads/main"})
    assert res == "executed successfully"
    mock_fn.assert_called_once_with(path="README.md", version="refs/heads/main")
