# pylint: disable=useless-return, bad-staticmethod-argument, duplicate-code, import-outside-toplevel, broad-exception-caught, unused-argument
"""Initializer of Auto Instrumentation of GPU Metrics"""

from typing import Collection, Iterable
import logging
from functools import partial
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from opentelemetry.metrics import get_meter, CallbackOptions, Observation
import pynvml

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

        # Initialize NVML
        pynvml.nvmlInit()

        metric_names = [
            ("GPU_UTILIZATION", "utilization"),
            ("GPU_UTILIZATION_ENC", "utilization_enc"),
            ("GPU_UTILIZATION_DEC", "utilization_dec"),
            ("GPU_TEMPERATURE", "temperature"),
            ("GPU_FAN_SPEED", "fan_speed"),
            ("GPU_MEMORY_AVAILABLE", "memory_available"),
            ("GPU_MEMORY_TOTAL", "memory_total"),
            ("GPU_MEMORY_USED", "memory_used"),
            ("GPU_MEMORY_FREE", "memory_free"),
            ("GPU_POWER_DRAW", "power_draw"),
            ("GPU_POWER_LIMIT", "power_limit"),
        ]

        for semantic_name, internal_name in metric_names:
            meter.create_observable_gauge(
                name=getattr(SemanticConvetion, semantic_name),
                callbacks=[partial(self._collect_metric,
                                   environment, application_name, internal_name)],
                description=f"GPU {internal_name.replace('_', ' ').title()}",
            )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass

    def _collect_metric(self, environment, application_name,
                        metric_name,
                        options: CallbackOptions) -> Iterable[Observation]:
        try:
            gpu_count = pynvml.nvmlDeviceGetCount()

            for gpu_index in range(gpu_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(gpu_index)

                def get_metric_value(handle, metric_name):
                    try:
                        if metric_name == "temperature":
                            return pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                        elif metric_name == "utilization":
                            return pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
                        elif metric_name == "utilization_enc" or metric_name == "utilization_dec":
                            # pynvml does not provide encoder/decoder utilization metrics directly
                            return 0
                        elif metric_name == "fan_speed":
                            return pynvml.nvmlDeviceGetFanSpeed(handle)
                        elif metric_name == "memory_available":
                            memory_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                            return memory_info.free  # Assuming reserved memory is 0
                        elif metric_name == "memory_total":
                            return pynvml.nvmlDeviceGetMemoryInfo(handle).total
                        elif metric_name == "memory_used":
                            return pynvml.nvmlDeviceGetMemoryInfo(handle).used
                        elif metric_name == "memory_free":
                            return pynvml.nvmlDeviceGetMemoryInfo(handle).free
                        elif metric_name == "power_draw":
                            return pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0  # convert mW to W
                        elif metric_name == "power_limit":
                            return pynvml.nvmlDeviceGetEnforcedPowerLimit(handle) / 1000.0  # convert mW to W
                    except Exception as e:
                        logger.error("Error collecting metric %s for GPU %d: %s", metric_name, gpu_index, e)
                    return 0

                attributes = {
                    TELEMETRY_SDK_NAME: "openlit",
                    SemanticConvetion.GEN_AI_APPLICATION_NAME: application_name,
                    SemanticConvetion.GEN_AI_ENVIRONMENT: environment,
                    SemanticConvetion.GPU_INDEX: str(gpu_index),
                    SemanticConvetion.GPU_UUID: pynvml.nvmlDeviceGetUUID(handle),
                    SemanticConvetion.GPU_NAME: pynvml.nvmlDeviceGetName(handle)
                }
                yield Observation(get_metric_value(handle, metric_name), attributes)

        except Exception as e:
            logger.error("Error in GPU metrics collection: %s", e)