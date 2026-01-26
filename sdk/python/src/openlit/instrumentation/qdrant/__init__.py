"""
OpenLIT Qdrant Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.qdrant.qdrant import general_wrap
from openlit.instrumentation.qdrant.async_qdrant import async_general_wrap

_instruments = ("qdrant-client >= 1.16.0",)

# Operations to wrap for both sync and async clients
QDRANT_OPERATIONS = [
    ("create_collection", "qdrant.create_collection"),
    ("delete_collection", "qdrant.delete_collection"),
    ("update_collection", "qdrant.update_collection"),
    ("upload_collection", "qdrant.upload_collection"),
    ("upsert", "qdrant.upsert"),
    ("set_payload", "qdrant.set_payload"),
    ("overwrite_payload", "qdrant.overwrite_payload"),
    ("clear_payload", "qdrant.clear_payload"),
    ("delete_payload", "qdrant.delete_payload"),
    ("upload_points", "qdrant.upload_points"),
    ("update_vectors", "qdrant.update_vectors"),
    ("delete_vectors", "qdrant.delete_vectors"),
    ("delete", "qdrant.delete"),
    ("retrieve", "qdrant.retrieve"),
    ("scroll", "qdrant.scroll"),
    ("create_payload_index", "qdrant.create_payload_index"),
    ("query_points", "qdrant.query_points"),
    ("query_batch_points", "qdrant.query_batch_points"),
    ("query_points_groups", "qdrant.query_points_groups"),
]


class QdrantInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Qdrant client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("qdrant-client")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        # #region agent log
        import json;from qdrant_client import QdrantClient;deprecated_methods=["search","search_groups","recommend"];new_methods=["query_points","query_points_groups","query_batch_points"];method_availability={"deprecated":{m:hasattr(QdrantClient,m) for m in deprecated_methods},"new":{m:hasattr(QdrantClient,m) for m in new_methods}};open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:48","message":"instrument_entry","data":{"qdrant_version":version,"method_availability":method_availability},"sessionId":"debug-session","runId":"initial","hypothesisId":"A,B"})+'\n')
        # #endregion

        # Wrap sync operations
        for method_name, endpoint in QDRANT_OPERATIONS:
            # #region agent log
            import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:64","message":"before_wrap_sync","data":{"method":method_name,"endpoint":endpoint},"sessionId":"debug-session","runId":"initial","hypothesisId":"A"})+'\n')
            # #endregion
            try:
                wrap_function_wrapper(
                    "qdrant_client",
                    f"QdrantClient.{method_name}",
                    general_wrap(
                        endpoint,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                    ),
                )
                # #region agent log
                import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:82","message":"wrap_sync_success","data":{"method":method_name},"sessionId":"debug-session","runId":"initial","hypothesisId":"A"})+'\n')
                # #endregion
            except Exception as e:
                # #region agent log
                import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:86","message":"wrap_sync_failed","data":{"method":method_name,"error":str(e),"error_type":type(e).__name__},"sessionId":"debug-session","runId":"initial","hypothesisId":"A,D"})+'\n')
                # #endregion
                pass

        # Wrap async operations
        for method_name, endpoint in QDRANT_OPERATIONS:
            # #region agent log
            import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:93","message":"before_wrap_async","data":{"method":method_name,"endpoint":endpoint},"sessionId":"debug-session","runId":"initial","hypothesisId":"A"})+'\n')
            # #endregion
            try:
                wrap_function_wrapper(
                    "qdrant_client",
                    f"AsyncQdrantClient.{method_name}",
                    async_general_wrap(
                        endpoint,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                    ),
                )
                # #region agent log
                import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:111","message":"wrap_async_success","data":{"method":method_name},"sessionId":"debug-session","runId":"initial","hypothesisId":"A"})+'\n')
                # #endregion
            except Exception as e:
                # #region agent log
                import json;open(r'd:\open-source\.cursor\debug.log','a').write(json.dumps({"timestamp":__import__('time').time()*1000,"location":"__init__.py:115","message":"wrap_async_failed","data":{"method":method_name,"error":str(e),"error_type":type(e).__name__},"sessionId":"debug-session","runId":"initial","hypothesisId":"A,D"})+'\n')
                # #endregion
                pass

    def _uninstrument(self, **kwargs):
        pass
