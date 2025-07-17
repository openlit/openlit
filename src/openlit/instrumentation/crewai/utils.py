# Create a wrapper instance that exposes model_name for common_framework_span_attributes
class ModelWrapper:
    """Wrapper class to expose model_name for framework span attributes."""
    def __init__(self, original_instance, model_name):
        self._original = original_instance
        self.model_name = model_name

    def __getattr__(self, name):
        return getattr(self._original, name)

    def get_original_instance(self):
        """Get the original wrapped instance."""
        return self._original 