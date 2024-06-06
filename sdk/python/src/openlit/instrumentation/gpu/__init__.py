# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of GPU Metrics"""

from typing import Dict, Collection
import time
import schedule
from opentelemetry import metrics
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

# Importing module 
import importlib 

class NvidiaGPUInstrumentor(BaseInstrumentor):
    """
    An instrumentor for collecting NVIDIA GPU metrics.
    """ 
        
    def instrumentation_dependencies(self) -> Collection[str]:
        return []

    def _instrument(self, **kwargs):
        import gpustat

        metrics_dict = kwargs.get("metrics_dict")
        # Start the schedule for collecting metrics
        self._start_schedule()

    def _collect_metrics(self, metrics_dict):
        import gpustat
        
        """Collect metrics from GPU statistics"""
        gpu_stats = gpustat.GPUStatCollection.new_query()

        for gpu in gpu_stats.gpus:
            metrics_dict["gpu_utilization"].record(gpu.utilization)
            metrics_dict["gpu_temperature"].record(gpu.temperature)
            metrics_dict["gpu_fan_speed"].record(gpu.fan_speed if gpu.fan_speed else 0)
            metrics_dict["gpu_memory_available"].record(gpu.memory_available)
            metrics_dict["gpu_memory_total"].record(gpu.memory_total)
            metrics_dict["gpu_memory_used"].record(gpu.memory_used)
            metrics_dict["gpu_memory_free"].record(gpu.memory_free)
            metrics_dict["gpu_power_draw"].record(gpu.power_draw if gpu.power_draw else 0)
            metrics_dict["gpu_power_limit"].record(gpu.power_limit if gpu.power_limit else 0)

    def _start_schedule(self):
        # Schedule the _collect_metrics method to run every 60 seconds
        schedule.every(60).seconds.do(self._collect_metrics)
        
        # Run the scheduler in a separate thread
        import threading
        def run_scheduler():
            while True:
                schedule.run_pending()
                time.sleep(1)  # Sleep for a short duration to prevent tight loop

        scheduler_thread = threading.Thread(target=run_scheduler)
        scheduler_thread.daemon = True  # Ensure thread exits when main program exits
        scheduler_thread.start()
    
    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass