"""
OpenLIT AstraDB Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.astra.astra import general_wrap
from openlit.instrumentation.astra.async_astra import async_general_wrap

_instruments = ("astrapy >= 1.5.2",)

# Operations to wrap for both sync and async clients
ASTRA_OPERATIONS = [
    # Database operations
    ("create_collection", "astra.create_collection"),
    ("drop_collection", "astra.drop_collection"),
    
    # Collection operations
    ("insert_one", "astra.insert_one"),
    ("insert_many", "astra.insert_many"),
    ("update_one", "astra.update_one"),
    ("update_many", "astra.update_many"),
    ("find_one_and_update", "astra.find_one_and_update"),
    ("find", "astra.find"),
    ("replace_one", "astra.replace_one"),
    ("find_one_and_delete", "astra.find_one_and_delete"),
    ("delete_one", "astra.delete_one"),
    ("delete_many", "astra.delete_many"),
]

class AstraInstrumentor(BaseInstrumentor):
    """
    An instrumentor for AstraDB's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("astrapy")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        # Wrap sync operations
        # Database operations
        for method_name, endpoint in [("create_collection", "astra.create_collection"), 
                                     ("drop_collection", "astra.drop_collection")]:
            wrap_function_wrapper(
                "astrapy.database",
                f"Database.{method_name}",
                general_wrap(
                    endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )

        # Collection operations
        for method_name, endpoint in [("insert_one", "astra.insert_one"),
                                     ("insert_many", "astra.insert_many"),
                                     ("update_one", "astra.update_one"),
                                     ("update_many", "astra.update_many"),
                                     ("find_one_and_update", "astra.find_one_and_update"),
                                     ("find", "astra.find"),
                                     ("replace_one", "astra.replace_one"),
                                     ("find_one_and_delete", "astra.find_one_and_delete"),
                                     ("delete_one", "astra.delete_one"),
                                     ("delete_many", "astra.delete_many")]:
            wrap_function_wrapper(
                "astrapy.collection",
                f"Collection.{method_name}",
                general_wrap(
                    endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )

        # Wrap async operations
        # Async Database operations
        for method_name, endpoint in [("create_collection", "astra.create_collection"), 
                                     ("drop_collection", "astra.drop_collection")]:
            wrap_function_wrapper(
                "astrapy.database",
                f"AsyncDatabase.{method_name}",
                async_general_wrap(
                    endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )

        # Async Collection operations
        for method_name, endpoint in [("insert_one", "astra.insert_one"),
                                     ("insert_many", "astra.insert_many"),
                                     ("update_one", "astra.update_one"),
                                     ("update_many", "astra.update_many"),
                                     ("find_one_and_update", "astra.find_one_and_update"),
                                     ("find", "astra.find"),
                                     ("replace_one", "astra.replace_one"),
                                     ("find_one_and_delete", "astra.find_one_and_delete"),
                                     ("delete_one", "astra.delete_one"),
                                     ("delete_many", "astra.delete_many")]:
            wrap_function_wrapper(
                "astrapy.collection",
                f"AsyncCollection.{method_name}",
                async_general_wrap(
                    endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )

    def _uninstrument(self, **kwargs):
        pass
