# Adding New Configuration Parameters - Single Source of Truth

OpenLIT uses a **centralized configuration system** where you only need to define a parameter **once** to make it available in both `openlit.init()` and `openlit-instrument` CLI.

## 🎯 **One Place to Add Parameters**

### Location: `/src/openlit/cli/config.py`

Add your new parameter to the `PARAMETER_CONFIG` dictionary:

```python
PARAMETER_CONFIG = {
    # ... existing parameters ...
    
    'your_new_parameter': {
        'default': 'default_value',  # Default value for openlit.init()
        'env_var': 'OTEL_YOUR_NEW_PARAMETER',  # Environment variable name
        'cli_help': 'Description of what this parameter does',  # CLI help text
        'cli_type': str,  # Type: str, bool, int, etc.
        # Optional special handling:
        # 'parser': 'json',  # For JSON parsing
        # 'parser': 'csv',   # For comma-separated values  
        # 'has_negation': True,  # For --no_parameter support
        # 'internal': True,  # Skip CLI exposure (internal parameters only)
    },
}
```

## ✅ **That's It!**

The centralized system automatically:

1. **Adds to `openlit.init()`** - Available as function parameter with default value
2. **Adds to CLI** - Available as `--your_new_parameter` argument  
3. **Adds to environment variables** - Available as `OTEL_YOUR_NEW_PARAMETER`
4. **Adds to help text** - Shows in `openlit-instrument --help`
5. **Handles type conversion** - Automatically converts env vars to correct type
6. **Maintains precedence** - Environment variables > CLI args > function params > defaults

## 🔧 **Parameter Types and Special Handling**

### Basic Types
```python
'my_string_param': {
    'default': 'hello',
    'cli_type': str,
    # ...
},

'my_bool_param': {
    'default': False,
    'cli_type': bool,
    # Creates --my_bool_param flag
    # ...
},

'my_int_param': {
    'default': 100,
    'cli_type': int,
    # ...
},
```

### Special Parsing
```python
'my_json_param': {
    'default': None,
    'cli_type': str,
    'parser': 'json',  # Parses JSON strings from env vars
    # ...
},

'my_list_param': {
    'default': None,
    'cli_type': str, 
    'parser': 'csv',  # Splits comma-separated values
    # ...
},
```

### Internal Parameters (Skip CLI)
```python
'my_internal_param': {
    'default': None,
    'internal': True,  # Won't appear in CLI arguments
    # ...
},
```

## 📋 **Examples**

### Adding a New Timeout Parameter

```python
# In config.py - ADD THIS ONLY
'request_timeout': {
    'default': 30,
    'env_var': 'OPENLIT_REQUEST_TIMEOUT',
    'cli_help': 'Request timeout in seconds',
    'cli_type': int,
},
```

**Automatically Available As:**
- `openlit.init(request_timeout=30)`
- `openlit-instrument --request_timeout 60 python app.py`  
- `OPENLIT_REQUEST_TIMEOUT=45 openlit-instrument python app.py`

### Adding a Feature Flag

```python
# In config.py - ADD THIS ONLY  
'enable_experimental_features': {
    'default': False,
    'env_var': 'OPENLIT_ENABLE_EXPERIMENTAL',
    'cli_help': 'Enable experimental features',
    'cli_type': bool,
},
```

**Automatically Available As:**
- `openlit.init(enable_experimental_features=True)`
- `openlit-instrument --enable_experimental_features python app.py`
- `OPENLIT_ENABLE_EXPERIMENTAL=true openlit-instrument python app.py`

### Adding a JSON Configuration

```python
# In config.py - ADD THIS ONLY
'custom_config': {
    'default': None,
    'env_var': 'OPENLIT_CUSTOM_CONFIG', 
    'cli_help': 'Custom configuration as JSON string',
    'cli_type': str,
    'parser': 'json',  # Automatically parses JSON
},
```

**Automatically Available As:**
- `openlit.init(custom_config={"key": "value"})`
- `openlit-instrument --custom_config '{"key":"value"}' python app.py`
- `OPENLIT_CUSTOM_CONFIG='{"key":"value"}' openlit-instrument python app.py`

## 🔍 **Validation and Debugging**

### Check Configuration Sync
```bash
python -c "from openlit.cli.config import validate_parameters; validate_parameters()"
```

### Generate Function Signature  
```bash
python -c "from openlit.cli.config import generate_init_signature; print(generate_init_signature())"
```

### Test Your Parameter
```bash
# Test CLI argument
openlit-instrument --your_new_parameter test_value python app.py

# Test environment variable  
YOUR_ENV_VAR=test_value openlit-instrument python app.py

# Test function parameter
python -c "import openlit; openlit.init(your_new_parameter='test_value')"
```

## 🚀 **Benefits of Single Source Configuration**

1. **No Duplication** - Define once, available everywhere
2. **Consistency** - Same parameter names across all interfaces
3. **Automatic Sync** - CLI and function signatures stay in sync
4. **Easy Maintenance** - Add/remove parameters in one place
5. **Type Safety** - Automatic type conversion and validation
6. **Standard Compliance** - Uses OpenTelemetry environment variable conventions

## ⚠️ **Important Notes**

- **CLI arguments use underscores** (`--application_name`) to match function parameters exactly
- **Environment variables** should follow OpenTelemetry standards (`OTEL_*`) or OpenLIT conventions (`OPENLIT_*`)
- **Boolean env vars** accept: `true`, `1`, `yes` (case-insensitive) for true values
- **Parameter order** in `PARAMETER_CONFIG` determines the order in generated function signatures
- **Internal parameters** (like `tracer`, `meter`) should be marked with `'internal': True`

This system ensures that **one definition creates three interfaces** - making OpenLIT configuration consistent and maintainable! 🎯