import openlit
import argparse

def main():
    parser = argparse.ArgumentParser(description="Configure GPU Monitoring for OpenLit")
    parser.add_argument('--application_name', type=str, default='default_app', help='Name of the application')
    parser.add_argument('--environment', type=str, default='production', help='Deployment environment')

    args = parser.parse_args()
    
    # Initialize OpenLit with provided parameters
    openlit.init(collect_gpu_stats=True, application_name=args.application_name, environment=args.environment)
    
    # Keep the script running indefinitely
    while True:
        pass  # Infinite loop to keep the script running

if __name__ == "__main__":
    main()