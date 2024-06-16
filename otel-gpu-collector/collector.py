import openlit
import os

def main():
    
    # Initialize OpenLit with provided parameters
    openlit.init(collect_gpu_stats=True,
                 application_name=os.getenv('GPU_APPLICATION_NAME', 'default'),
                 environment=os.getenv('GPU_ENVIRONMENT', 'default'))
    
    # Keep the script running indefinitely
    while True:
        pass  # Infinite loop to keep the script running

if __name__ == "__main__":
    main()
