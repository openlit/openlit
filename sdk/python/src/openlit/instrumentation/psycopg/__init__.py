"""
OpenLIT Psycopg (PostgreSQL) Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.psycopg.psycopg import (
    execute_wrap,
    executemany_wrap,
    copy_wrap,
    commit_wrap,
    rollback_wrap,
    callproc_wrap,
)
from openlit.instrumentation.psycopg.async_psycopg import (
    async_execute_wrap,
    async_executemany_wrap,
    async_copy_wrap,
    async_commit_wrap,
    async_rollback_wrap,
    async_callproc_wrap,
    async_pool_getconn_wrap,
)

_instruments = ("psycopg >= 3.0.0",)

# Cursor operations to wrap (method_name, endpoint_name)
CURSOR_OPERATIONS = [
    ("execute", "psycopg.cursor.execute"),
    ("executemany", "psycopg.cursor.executemany"),
    ("copy", "psycopg.cursor.copy"),
    ("callproc", "psycopg.cursor.callproc"),
]

# Connection operations to wrap
CONNECTION_OPERATIONS = [
    ("commit", "psycopg.connection.commit"),
    ("rollback", "psycopg.connection.rollback"),
]

# Cursor class mappings
SYNC_CURSOR_CLASSES = [
    "Cursor",
    "ClientCursor",
    "ServerCursor",
    "RawCursor",
]

ASYNC_CURSOR_CLASSES = [
    "AsyncCursor",
    "AsyncClientCursor",
    "AsyncServerCursor",
    "AsyncRawCursor",
]

# Wrapper function mappings for cursor operations
SYNC_CURSOR_WRAPPERS = {
    "execute": execute_wrap,
    "executemany": executemany_wrap,
    "copy": copy_wrap,
    "callproc": callproc_wrap,
}

ASYNC_CURSOR_WRAPPERS = {
    "execute": async_execute_wrap,
    "executemany": async_executemany_wrap,
    "copy": async_copy_wrap,
    "callproc": async_callproc_wrap,
}

# Wrapper function mappings for connection operations
SYNC_CONNECTION_WRAPPERS = {
    "commit": commit_wrap,
    "rollback": rollback_wrap,
}

ASYNC_CONNECTION_WRAPPERS = {
    "commit": async_commit_wrap,
    "rollback": async_rollback_wrap,
}


class PsycopgInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Psycopg (PostgreSQL) library.
    
    This instrumentor wraps:
    - Cursor.execute, executemany, copy, callproc (sync and async)
    - Connection.commit, rollback (sync and async)
    - ConnectionPool operations (optional, from psycopg_pool)
    
    Configuration Options:
    - capture_parameters: If True, captures query parameters in spans.
      WARNING: This may expose sensitive data like passwords, PII, tokens.
      Only enable in development or when you're certain parameters are safe.
      Default: False
      
    - enable_sqlcommenter: If True, injects OpenTelemetry trace context as SQL
      comments (SQLCommenter format). This enables correlation between 
      application traces and database logs (pg_stat_statements, auto_explain).
      Default: False
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        # Get psycopg version
        try:
            version = importlib.metadata.version("psycopg")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"
        
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        
        # New configuration options
        capture_parameters = kwargs.get("capture_parameters", False)
        enable_sqlcommenter = kwargs.get("enable_sqlcommenter", False)

        # Wrap sync cursor operations
        for cursor_class in SYNC_CURSOR_CLASSES:
            for method_name, endpoint in CURSOR_OPERATIONS:
                wrapper_func = SYNC_CURSOR_WRAPPERS.get(method_name)
                if wrapper_func:
                    try:
                        wrap_function_wrapper(
                            "psycopg",
                            f"{cursor_class}.{method_name}",
                            wrapper_func(
                                endpoint,
                                version,
                                environment,
                                application_name,
                                tracer,
                                pricing_info,
                                capture_message_content,
                                metrics,
                                disable_metrics,
                                capture_parameters,
                                enable_sqlcommenter,
                            ),
                        )
                    except Exception:
                        # Class might not exist in all psycopg versions
                        pass

        # Wrap async cursor operations
        for cursor_class in ASYNC_CURSOR_CLASSES:
            for method_name, endpoint in CURSOR_OPERATIONS:
                wrapper_func = ASYNC_CURSOR_WRAPPERS.get(method_name)
                if wrapper_func:
                    try:
                        wrap_function_wrapper(
                            "psycopg",
                            f"{cursor_class}.{method_name}",
                            wrapper_func(
                                endpoint,
                                version,
                                environment,
                                application_name,
                                tracer,
                                pricing_info,
                                capture_message_content,
                                metrics,
                                disable_metrics,
                                capture_parameters,
                                enable_sqlcommenter,
                            ),
                        )
                    except Exception:
                        # Class might not exist in all psycopg versions
                        pass

        # Wrap sync connection operations
        for method_name, endpoint in CONNECTION_OPERATIONS:
            wrapper_func = SYNC_CONNECTION_WRAPPERS.get(method_name)
            if wrapper_func:
                try:
                    wrap_function_wrapper(
                        "psycopg",
                        f"Connection.{method_name}",
                        wrapper_func(
                            endpoint,
                            version,
                            environment,
                            application_name,
                            tracer,
                            pricing_info,
                            capture_message_content,
                            metrics,
                            disable_metrics,
                            capture_parameters,
                            enable_sqlcommenter,
                        ),
                    )
                except Exception:
                    pass

        # Wrap async connection operations
        for method_name, endpoint in CONNECTION_OPERATIONS:
            wrapper_func = ASYNC_CONNECTION_WRAPPERS.get(method_name)
            if wrapper_func:
                try:
                    wrap_function_wrapper(
                        "psycopg",
                        f"AsyncConnection.{method_name}",
                        wrapper_func(
                            endpoint,
                            version,
                            environment,
                            application_name,
                            tracer,
                            pricing_info,
                            capture_message_content,
                            metrics,
                            disable_metrics,
                            capture_parameters,
                            enable_sqlcommenter,
                        ),
                    )
                except Exception:
                    pass

        # Try to instrument psycopg_pool if available
        self._instrument_pool(
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
            capture_parameters,
            enable_sqlcommenter,
        )

    def _instrument_pool(
        self,
        version,
        environment,
        application_name,
        tracer,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
        capture_parameters=False,
        enable_sqlcommenter=False,
    ):
        """
        Instrument psycopg_pool connection pool operations.
        """
        try:
            # Try to get psycopg_pool version
            pool_version = importlib.metadata.version("psycopg-pool")
        except importlib.metadata.PackageNotFoundError:
            # psycopg_pool not installed, skip pool instrumentation
            return

        # Wrap sync ConnectionPool.getconn
        try:
            wrap_function_wrapper(
                "psycopg_pool",
                "ConnectionPool.getconn",
                commit_wrap(  # Reuse commit wrapper structure for pool ops
                    "psycopg.pool.getconn",
                    pool_version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    capture_parameters,
                    enable_sqlcommenter,
                ),
            )
        except Exception:
            pass

        # Wrap async AsyncConnectionPool.getconn
        try:
            wrap_function_wrapper(
                "psycopg_pool",
                "AsyncConnectionPool.getconn",
                async_pool_getconn_wrap(
                    "psycopg.pool.async_getconn",
                    pool_version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    capture_parameters,
                    enable_sqlcommenter,
                ),
            )
        except Exception:
            pass

    def _uninstrument(self, **kwargs):
        pass
