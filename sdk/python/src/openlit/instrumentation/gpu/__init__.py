# pylint: disable=useless-return, bad-staticmethod-argument, duplicate-code, import-outside-toplevel, broad-exception-caught, unused-argument
"""Initializer of Auto Instrumentation of GPU Metrics"""

from typing import Collection, Iterable
import logging
from functools import partial

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from opentelemetry.metrics import get_meter, CallbackOptions, Observation

from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

class NvidiaGPUInstrumentor(BaseInstrumentor):
    """
    An instrumentor for collecting NVIDIA GPU metrics.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return []

    def _instrument(self, **kwargs):

        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")

        meter = get_meter(
            __name__,
            "0.1.0",
            schema_url="https://opentelemetry.io/schemas/1.11.0",
        )

        def check_and_record(value):
            return value if value is not None else 0

        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_UTILIZATION,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "utilization")],
            description="GPU Utilization",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_UTILIZATION_ENC,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "utilization_enc")],
            description="GPU Encoder Utilization",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_UTILIZATION_DEC,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "utilization_dec")],
            description="GPU Decoder Utilization",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_TEMPERATURE,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "temperature")],
            description="GPU Temperature",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_FAN_SPEED,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "fan_speed")],
            description="GPU Fan Speed",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_MEMORY_AVAILABLE,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "memory_available")],
            description="GPU Memory Available",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_MEMORY_TOTAL,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "memory_total")],
            description="GPU Memory Total",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_MEMORY_USED,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "memory_used")],
            description="GPU Memory Used",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_MEMORY_FREE,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "memory_free")],
            description="GPU Memory Free",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_POWER_DRAW,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "power_draw")],
            description="GPU Power Draw",
        )
        meter.create_observable_gauge(
            name=SemanticConvetion.GPU_POWER_LIMIT,
            callbacks=[partial(self._collect_metric, environment,
                               application_name, check_and_record, "power_limit")],
            description="GPU Power Limit",
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass

    def _collect_metric(self, environment, application_name,
                        check_and_record, metric_name,
                        options: CallbackOptions) -> Iterable[Observation]:

        import gpustat

        try:
            gpu_stats = gpustat.GPUStatCollection.new_query()

            for gpu in gpu_stats.gpus:
                attributes = {
                    TELEMETRY_SDK_NAME: "openlit",
                    SemanticConvetion.GEN_AI_APPLICATION_NAME: application_name,
                    SemanticConvetion.GEN_AI_ENVIRONMENT: environment,
                    SemanticConvetion.GPU_INDEX: gpu.index,
                    SemanticConvetion.GPU_UUID: gpu.uuid,
                    SemanticConvetion.GPU_NAME: gpu.name,
                }

                yield Observation(check_and_record(getattr(gpu, metric_name, 0)), attributes)

        except Exception as e:
            logger.error("Error in GPU metrics collection: %s", e)
