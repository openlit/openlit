import openlit
import os
import logging
import sys
import json
import signal

# Create a JSON logger
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "level": record.levelname,
            "message": record.getMessage(),
            "timestamp": record.created,
            "name": record.name,
            "funcName": record.funcName,
            "lineno": record.lineno,
        }
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)

def setup_logger():
    logger = logging.getLogger("otel-gpu-collector")
    logger.setLevel(logging.INFO)
    
    # Log to stdout
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    
    logger.addHandler(handler)
    return logger

# Initialize logger
logger = setup_logger()

# Flag to control the infinite loop
keep_running = True

def signal_handler(sig, frame):
    global keep_running
    logger.info("Received termination signal")
    keep_running = False

def main():
    logger.info("Starting otel-gpu-collector")

    try:
        application_name = os.getenv('GPU_APPLICATION_NAME', 'default')
        environment = os.getenv('GPU_ENVIRONMENT', 'default')

        # Initialize OpenLit with provided parameters
        logger.info("Initializing OpenLit", extra={"application_name": application_name, "environment": environment})
        openlit.init(collect_gpu_stats=True, application_name=application_name, environment=environment)
        
        # Register signal handlers
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)
        
        # Keep the script running indefinitely
        global keep_running
        while keep_running:
            pass  # Infinite loop to keep the script running

    except Exception as e:
        logger.error("An error occurred", exc_info=True)
    finally:
        logger.info("Shutting down GPU Monitor Service")

if __name__ == "__main__":
    main()