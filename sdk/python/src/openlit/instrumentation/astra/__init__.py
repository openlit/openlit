"""Initializer of Auto Instrumentation of AstraDB Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.astra.astra import general_wrap
# from openlit.instrumentation.astra.async_astra import asyc_general_wrap

_instruments = ('astrapy >= 1.5.2',)

class AstraInstrumentor(BaseInstrumentor):
    """An instrumentor for AstraDB's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get('application_name')
        environment = kwargs.get('environment')
        tracer = kwargs.get('tracer')
        metrics = kwargs.get('metrics_dict')
        pricing_info = kwargs.get('pricing_info')
        capture_message_content = kwargs.get('capture_message_content')
        disable_metrics = kwargs.get('disable_metrics')
        version = importlib.metadata.version('astrapy')

        # Sync
        wrap_function_wrapper(
            'astrapy.database',
            'Database.create_collection',
            general_wrap('astra.create_collection', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.database',
            'Database.drop_collection',
            general_wrap('astra.drop_collection', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.insert_one',
            general_wrap('astra.insert', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.insert_many',
            general_wrap('astra.insert', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.update_one',
            general_wrap('astra.update', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.update_many',
            general_wrap('astra.update', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.find_one_and_update',
            general_wrap('astra.find_one_and_update', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.find',
            general_wrap('astra.find', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.replace_one',
            general_wrap('astra.replace_one', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.find_one_and_delete',
            general_wrap('astra.find_one_and_delete', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.delete_one',
            general_wrap('astra.delete', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'Collection.delete_many',
            general_wrap('astra.delete', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # ASync
        wrap_function_wrapper(
            'astrapy.database',
            'AsyncDatabase.create_collection',
            general_wrap('astra.create_collection', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.database',
            'AsyncDatabase.drop_collection',
            general_wrap('astra.drop_collection', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.insert_one',
            general_wrap('astra.insert_one', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.insert_many',
            general_wrap('astra.insert_many', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.update_one',
            general_wrap('astra.update_one', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.update_many',
            general_wrap('astra.update_many', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.find_one_and_update',
            general_wrap('astra.find_one_and_update', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.find',
            general_wrap('astra.find', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.replace_one',
            general_wrap('astra.replace_one', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.find_one_and_delete',
            general_wrap('astra.find_one_and_delete', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.delete_one',
            general_wrap('astra.delete_one', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'astrapy.collection',
            'AsyncCollection.delete_many',
            general_wrap('astra.delete_many', version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
