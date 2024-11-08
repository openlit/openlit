# pylint: disable=useless-return, bad-staticmethod-argument, duplicate-code, import-outside-toplevel, broad-exception-caught, unused-argument
"""Initializer of Auto Instrumentation of GPU Metrics"""

from typing import Collection, Iterable
import logging
from functools import partial
from subprocess import check_output, CalledProcessError
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from opentelemetry.metrics import get_meter, CallbackOptions, Observation
import xmltodict

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
            gpu_stats = xmltodict.parse(check_output(["/usr/bin/nvidia-smi", "-x", "-q"]))

            def get_metric_value(gpu, metric_name):
                try:
                    if metric_name == "temperature":
                        return int(gpu["temperature"]["gpu_temp"].replace(' C', ''))
                    elif metric_name == "utilization":
                        return int(gpu["utilization"]["gpu_util"].replace(' %', ''))
                    elif metric_name == "utilization_enc":
                        return int(gpu["utilization"]["encoder_util"].replace(' %', ''))
                    elif metric_name == "utilization_dec":
                        return int(gpu["utilization"]["decoder_util"].replace(' %', ''))
                    elif metric_name == "fan_speed":
                        fan_speed_value = gpu["fan_speed"]
                        return 0 if fan_speed_value == 'N/A' else int(fan_speed_value.replace(' %', ''))
                    elif metric_name == "memory_available":
                        return int(gpu["fb_memory_usage"]["free"].replace(' MiB', '')) - int(gpu["fb_memory_usage"]["reserved"].replace(' MiB', ''))
                    elif metric_name == "memory_total":
                        return int(gpu["fb_memory_usage"]["total"].replace(' MiB', ''))
                    elif metric_name == "memory_used":
                        return int(gpu["fb_memory_usage"]["used"].replace(' MiB', ''))
                    elif metric_name == "memory_free":
                        return int(gpu["fb_memory_usage"]["free"].replace(' MiB', ''))
                    elif metric_name == "power_draw":
                        return float(gpu["gpu_power_readings"]["power_draw"].replace(' W', ''))
                        print(float(gpu["gpu_power_readings"]["power_draw"].replace(' W', '')))
                    elif metric_name == "power_limit":
                        return float(gpu["gpu_power_readings"]["current_power_limit"].replace(' W', ''))
                except KeyError as e:
                    logger.error("Missing metric %s in GPU data: %s", metric_name, e)
                except ValueError as e:
                    logger.error("Invalid value for metric %s: %s", metric_name, e)

                return 0

            if gpu_stats["nvidia_smi_log"]["attached_gpus"] == "1":
                # Single GPU case
                gpus = [gpu_stats["nvidia_smi_log"]["gpu"]]
            else:
                # Multiple GPUs case
                gpus = gpu_stats["nvidia_smi_log"]["gpu"]

            for gpu in gpus:
                attributes = {
                    TELEMETRY_SDK_NAME: "openlit",
                    SemanticConvetion.GEN_AI_APPLICATION_NAME: application_name,
                    SemanticConvetion.GEN_AI_ENVIRONMENT: environment,
                    SemanticConvetion.GPU_INDEX: gpu['@id'],
                    SemanticConvetion.GPU_UUID: gpu['uuid'],
                    SemanticConvetion.GPU_NAME: gpu['product_name'],
                }
                yield Observation(get_metric_value(gpu, metric_name), attributes)

        except CalledProcessError as e:
            logger.error("Error executing nvidia-smi: %s", e)
        except Exception as e:
            logger.error("Error in GPU metrics collection: %s", e)