# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of GPU Metrics"""

from typing import Dict, Collection
import time
import schedule
import logging
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from functools import partial
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
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
        import gpustat

        metrics_dict = kwargs.get("metrics_dict")
        gpu_stats_interval = kwargs.get("gpu_stats_interval")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        start_schedule(metrics_dict, gpu_stats_interval, environment, application_name)
    
    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass

def start_schedule(metrics_dict, gpu_stats_interval, environment, application_name):
    # Schedule the _collect_metrics method to run every 60 seconds
    schedule.every(gpu_stats_interval).seconds.do(partial(
            collect_metrics, metrics_dict, environment, application_name))
    
    # Run the scheduler in a separate thread
    import threading
    def run_scheduler():
        while True:
            schedule.run_pending()
            time.sleep(1)  # Sleep for a short duration to prevent tight loop

    scheduler_thread = threading.Thread(target=run_scheduler)
    scheduler_thread.daemon = True  # Ensure thread exits when main program exits
    scheduler_thread.start()

def collect_metrics(metrics_dict, environment, application_name):
    try:
        import gpustat
        
        """Collect metrics from GPU statistics"""
        gpu_stats = gpustat.GPUStatCollection.new_query()

        for gpu in gpu_stats.gpus:
            attributes = {
                TELEMETRY_SDK_NAME:
                    "openlit",
                SemanticConvetion.GEN_AI_APPLICATION_NAME:
                    application_name,
                SemanticConvetion.GEN_AI_SYSTEM:
                    SemanticConvetion.GEN_AI_SYSTEM_MISTRAL,
                SemanticConvetion.GEN_AI_ENVIRONMENT:
                    environment,
                SemanticConvetion.GPU_INDEX:
                    gpu.index,
                SemanticConvetion.GPU_UUID:
                    gpu.uuid,
                SemanticConvetion.GPU_NAME:
                    gpu.name,

            }

            metrics_dict["gpu_utilization"].record(gpu.utilization if gpu.utilization else 0, attributes)
            metrics_dict["gpu_utilization_enc"].record(gpu.utilization_enc if gpu.utilization_enc else 0, attributes)
            metrics_dict["gpu_utilization_dec"].record(gpu.utilization_dec if gpu.utilization_dec else 0, attributes)
            metrics_dict["gpu_temperature"].record(gpu.temperature if gpu.temperature else 0, attributes)
            metrics_dict["gpu_fan_speed"].record(gpu.fan_speed if gpu.fan_speed else 0, attributes)
            metrics_dict["gpu_memory_available"].record(gpu.memory_available if gpu.memory_available else 0, attributes)
            metrics_dict["gpu_memory_total"].record(gpu.memory_total if gpu.memory_total else 0, attributes)
            metrics_dict["gpu_memory_used"].record(gpu.memory_used if gpu.memory_used else 0, attributes)
            metrics_dict["gpu_memory_free"].record(gpu.memory_free if gpu.memory_free else 0, attributes)
            metrics_dict["gpu_power_draw"].record(gpu.power_draw if gpu.power_draw else 0, attributes)
            metrics_dict["gpu_power_limit"].record(gpu.power_limit if gpu.power_limit else 0, attributes)
        
    except Exception as e:
        logger.error("Error in GPU metrics collection: %s", e)