export const DATABASE_CONFIG_NOT_FOUND = "No database config present!";
export const UNAUTHORIZED_USER = "Unauthorized user!";
export const FORBIDDEN_ACTION = "You do not have permission to perform this action.";
export const NO_ORGANISATION_SELECTED = "No active organisation. Switch organisations to continue.";
export const MALFORMED_INPUTS = "Malformed input! Please check the docs";
export const OPERATION_FAILED = "Operation failed!";

// API Keys
export const NO_API_KEY = "No such apiKey exists!";

// Prompts
export const PROMPT_NAME_TAKEN = "Prompt name is already taken!";
export const PROMPT_NOT_CREATED = "Prompt cannot be created!";
export const PROMPT_SAVED = "Prompt saved successfully!";
export const NO_PROMPT = "No such prompt exists or isn't released yet!";
export const PROMPT_DELETED = "Prompt deleted successfully!";
export const PROMPT_NOT_DELETED = "Error deleting prompt!";
export const VERSION_NOT_CREATED = "Version cannot be created";
export const VERSION_NOT_SAVED = "Version cannot be saved";
export const VERSION_SAVED = "Prompt Version saved successfully!";
export const DOWNLOAD_INFO_NOT_SAVED = "Download info cannot be saved!";
export const PROMPT_TIPS_TO_USE_VARIABLES = "Tip: Use {{variableName}} to add variables";

// Vault
export const SECRET_NAME_TAKEN = "Secret name is taken!";
export const SECRET_SAVED = "Secret saved successfully!";
export const SECRET_NOT_SAVED = "Secret cannot be saved";
export const SECRET_DELETED = "Secret deleted successfully!";
export const SECRET_NOT_DELETED = "Error deleting secret!";

// Evaluations
export const EVALUATION_CONFIG_NOT_FOUND = "Evaluation config not set!";
export const EVALUATION_VAULT_SECRET_NOT_FOUND =
	"Evaluation secret for provider not found!";
export const EVALUATION_CONFIG_SET_ERROR = "Evaluation config cannot be set!";
export const EVALUATION_CONFIG_NOT_SET =
	"Evaluation config not set! Please set the config first to run evaluations.";
export const EVALUATION_CONFIG_SET = "Setup Evaluation!";
export const EVALUATION_NOT_RUN_YET =
	"AI Evaluation has not run yet! Please run the evaluation to get results.";
export const EVALUATION_RUN = "Run Evaluation";
export const EVALUATION_RUN_AGAIN = "Run Evaluation Again";
export const EVALUATION_RUN_COUNT = (count: number) =>
	`${count} run${count !== 1 ? "s" : ""}`;
export const EVALUATION_RUNS = "Runs";
export const EVALUATION_RESULTS = "Evaluations";
export const EVALUATION_DATA_LOADING = "Loading evaluation data...";
export const EVALUATION_CREATED = "Evaluation created successfully!";
export const EVALUATION_UPDATED = "Evaluation updated successfully!";
export const EVALUATION_CONFIG_MODIFYING = "Modifying evaluation config...";
export const EVALUATION_CONFIG_INVALID = "Invalid evaluation config!";
export const EVALUATION_CONFIG_UPDATING_FAILED =
	"Evaluation config updation failed!";
export const EVALUATION_RUN_FAILURE = "Evaluation run failed!";
export const EVALUATION_FEEDBACK_SAVE_FAILURE = "Failed to save feedback";
export const EVALUATION_CLASSIFICATION = "Classification";
export const EVALUATION_EXPLANATION = "Explanation";
export const EVALUATION_VERDICT = "Verdict";
export const EVALUATION_RULE_ENGINE_DETAILS = "Rule Engine & Run Details";
export const EVALUATION_SOURCE = "Source";
export const EVALUATION_SOURCE_MANUAL = "Manual";
export const EVALUATION_SOURCE_AUTO = "Auto";
export const EVALUATION_ENGINE = "Engine";
export const EVALUATION_RULES_APPLIED = "Rules applied";
export const EVALUATION_CONTEXT = "Context";
export const EVALUATION_CONTEXT_APPLIED = "Applied from context entities";
export const EVALUATION_NO_RESULTS = "No evaluations";

// Evaluation Settings page
export const EVALUATION_VAULT_KEY_NOT_FOUND = "Unable to find the vault key.";
export const EVALUATION_CREATE_NEW = "Create new";
export const EVALUATION_ENGINE_TITLE = "Evaluation Engine";
export const EVALUATION_ENGINE_DESCRIPTION =
	"Choose the evaluation framework. Rule engine context and evaluation types are applied for both manual and auto runs.";
export const EVALUATION_ENGINE_LABEL = "Engine";
export const EVALUATION_CONFIG_SECTION = "Configuration";
export const EVALUATION_PROVIDER_LABEL = "Provider";
export const EVALUATION_SELECT_PROVIDER = "Select provider";
export const EVALUATION_MODEL_LABEL = "Model";
export const EVALUATION_SELECT_MODEL = "Select model";
export const EVALUATION_MODEL_PLACEHOLDER = "e.g. gpt-4o-mini or custom model name";
export const EVALUATION_MODEL_CUSTOM_HINT =
	"Select from suggestions or type any model name supported by the provider.";
export const EVALUATION_SELECT_PROVIDER_FIRST = "Select provider first";
export const EVALUATION_API_KEY_VAULT = "API Key (Vault)";
export const EVALUATION_SELECT_VAULT_KEY = "Select vault key";
export const EVALUATION_AUTO_TITLE = "Auto Evaluation";
export const EVALUATION_AUTO_DESCRIPTION =
	"Runs Hallucination, Bias, and Toxicity by default. Rule engine evaluates traces, fetches context, and runs evaluation on schedule.";
export const EVALUATION_ENABLE_AUTO = "Enable auto evaluation";
export const EVALUATION_ENABLE_AUTO_DESCRIPTION =
	"Evaluate new traces on a schedule";
export const EVALUATION_CRON_SCHEDULE = "Cron schedule";
export const EVALUATION_CRON_PLACEHOLDER = "* * * * *";
export const EVALUATION_CRON_HELP =
	"Standard cron expression (e.g. 0 * * * * for hourly)";
export const EVALUATION_SAVING = "Saving...";
export const EVALUATION_SAVE_CHANGES = "Save Changes";
export const EVALUATION_CREATE_CONFIG = "Create Config";
export const EVALUATION_MANUAL_TITLE = "Manual Evaluation";
export const EVALUATION_MANUAL_DESCRIPTION =
	"Run evaluations manually from the trace request details. Manual runs are stored in ClickHouse with source=manual.";
export const EVALUATION_MANUAL_STEP_1 =
	"Go to Requests and open chat/completion trace";
export const EVALUATION_MANUAL_STEP_2 =
	"Click the Evaluation tab in the trace details";
export const EVALUATION_MANUAL_STEP_3 =
	'Click "Run Evaluation" to evaluate the trace';
export const EVALUATION_GO_TO_REQUESTS = "Go to Requests";
export const EVALUATION_MANUAL_AND_AUTO = "Manual & Auto";
export const EVALUATION_MANUAL_AND_AUTO_DESCRIPTION =
	"Manual and Auto evaluations use the Rule Engine context applied in evaluation types when rules match the trace. Manual runs are stored with source=manual; Auto runs are stored with source=auto.";

// Manual feedback
export const EVALUATION_MANUAL_FEEDBACK = "Feedback";
export const EVALUATION_MANUAL_FEEDBACK_DESCRIPTION =
	"Add your feedback on this response";
export const EVALUATION_FEEDBACK_POSITIVE = "Good";
export const EVALUATION_FEEDBACK_NEGATIVE = "Bad";
export const EVALUATION_FEEDBACK_NEUTRAL = "Neutral";
export const EVALUATION_FEEDBACK_COMMENT_PLACEHOLDER = "Optional comment...";
export const EVALUATION_FEEDBACK_SUBMIT = "Submit Feedback";
export const EVALUATION_FEEDBACK_SAVED = "Feedback saved!";

// Traces
export const TRACE_NOT_FOUND = "Trace not found!";
export const TRACE_FETCHING_ERROR = "Error fetching trace!";

// Observability
export const OBSERVABILITY_TITLE = "Telemetry";
export const OBSERVABILITY_TRACE_LOADING = "Loading trace...";
export const OBSERVABILITY_LOADING = "Loading...";
export const OBSERVABILITY_TRACE_DETAILS = "Trace Details";
export const OBSERVABILITY_TRACES = "Traces";
export const OBSERVABILITY_EXCEPTIONS = "Exceptions";
export const OBSERVABILITY_METRICS = "Metrics";
export const OBSERVABILITY_LOGS = "Logs";
export const OBSERVABILITY_TRACE_SHORT_LABEL = "Latency, cost, tokens";
export const OBSERVABILITY_EXCEPTION_SHORT_LABEL = "Failures and error spans";
export const OBSERVABILITY_METRIC_SHORT_LABEL = "Gauges, sums, histograms";
export const OBSERVABILITY_LOG_SHORT_LABEL = "Events and correlated context";
export const OBSERVABILITY_TRACE_SUMMARY = "Span flow";
export const OBSERVABILITY_EXCEPTION_SUMMARY = "Failure path";
export const OBSERVABILITY_METRIC_SUMMARY = "Signal shape";
export const OBSERVABILITY_LOG_SUMMARY = "Event stream";
export const OBSERVABILITY_BACK = "Back";
export const OBSERVABILITY_DURATION = "Duration";
export const OBSERVABILITY_TOKENS = "Tokens";
export const OBSERVABILITY_COST = "Cost";
export const OBSERVABILITY_MODEL = "Model";
export const OBSERVABILITY_TRACE_ID = "Trace ID";
export const OBSERVABILITY_SPAN_ID = "Span ID";
export const OBSERVABILITY_SERVICE = "Service";
export const OBSERVABILITY_APPLICATION = "Application";
export const OBSERVABILITY_SYSTEM = "System";
export const OBSERVABILITY_UNKNOWN_SERVICE = "unknown service";
export const OBSERVABILITY_UNKNOWN_APP = "unknown app";
export const OBSERVABILITY_PREVIOUS_SPAN = "Previous span";
export const OBSERVABILITY_NEXT_SPAN = "Next span";
export const OBSERVABILITY_SPAN_ATTRIBUTES = "Span Attributes";
export const OBSERVABILITY_RESOURCE_ATTRIBUTES = "Resource Attributes";
export const OBSERVABILITY_SCOPE_ATTRIBUTES = "Scope Attributes";
export const OBSERVABILITY_LOG_ATTRIBUTES = "Log Attributes";
export const OBSERVABILITY_METRIC_ATTRIBUTES = "Metric Attributes";
export const OBSERVABILITY_RAW_RECORD = "Raw Record";
export const OBSERVABILITY_RAW_LOG = "Raw Log";
export const OBSERVABILITY_FIELD = "Field";
export const OBSERVABILITY_VALUE = "Value";
export const OBSERVABILITY_TYPES = "Types";
export const OBSERVABILITY_MODELS = "Models";
export const OBSERVABILITY_PROVIDERS = "Providers";
export const OBSERVABILITY_MAX_COST = "Max Cost";
export const OBSERVABILITY_APPLICATION_NAMES = "Application Names";
export const OBSERVABILITY_SPAN_NAMES = "Span Names";
export const OBSERVABILITY_ENVIRONMENTS = "Environments";
export const OBSERVABILITY_SERVICES = "Services";
export const OBSERVABILITY_SEVERITIES = "Severities";
export const OBSERVABILITY_METRIC_NAMES = "Metric Names";
export const OBSERVABILITY_METRIC_TYPES = "Metric Types";
export const OBSERVABILITY_COPY_UNSUPPORTED =
	"Copy to clipboard is not supported in this browser";
export const OBSERVABILITY_LINK_COPIED = "Link copied to clipboard";
export const OBSERVABILITY_LINK_COPY_FAILED = "Could not copy link";
export const OBSERVABILITY_COPY_SHARE_LINK = "Copy shareable link";
export const OBSERVABILITY_TIME = "Time";
export const OBSERVABILITY_SEVERITY = "Severity";
export const OBSERVABILITY_BODY = "Body";
export const OBSERVABILITY_METRIC = "Metric";
export const OBSERVABILITY_TYPE = "Type";
export const OBSERVABILITY_UNIT = "Unit";
export const OBSERVABILITY_LATEST = "Latest";
export const OBSERVABILITY_POINTS = "Points";
export const OBSERVABILITY_LAST_SEEN = "Last Seen";
export const OBSERVABILITY_LOG_ENTRY = "Log entry";
export const OBSERVABILITY_LATEST_METRIC_ATTRIBUTES =
	"Latest Metric Attributes";
export const OBSERVABILITY_LATEST_RESOURCE_ATTRIBUTES =
	"Latest Resource Attributes";
export const OBSERVABILITY_LATEST_SCOPE_ATTRIBUTES = "Latest Scope Attributes";
export const OBSERVABILITY_LATEST_METRIC_POINT = "Latest Metric Point";
export const OBSERVABILITY_LOADED_POINTS = "Loaded Points";
export const OBSERVABILITY_CLOSE = "Close";
export const OBSERVABILITY_FIELDS = "Fields";
export const OBSERVABILITY_LOG_ATTRS = "Log Attrs";
export const OBSERVABILITY_RESOURCE = "Resource";
export const OBSERVABILITY_SCOPE = "Scope";
export const OBSERVABILITY_RAW = "Raw";
export const OBSERVABILITY_AUTO = "Auto";
export const OBSERVABILITY_METRIC_POINTS = "Metric points";
export const OBSERVABILITY_LOG_EVENTS = "Log events";
export const OBSERVABILITY_SPANS = "Spans";
export const OBSERVABILITY_TOTAL = "Total";
export const OBSERVABILITY_PEAK = "Peak";
export const OBSERVABILITY_SPAN_HIERARCHY = "Span Hierarchy";
export const OBSERVABILITY_LOADING_SPANS = "Loading spans";
export const OBSERVABILITY_SPAN_COUNT = (count: string) => `${count} spans`;
export const OBSERVABILITY_SPAN_COUNT_WITH_COST = (count: string, cost: string) =>
	`${count} spans / $${cost}`;
export const OBSERVABILITY_HIERARCHY_UNAVAILABLE =
	"Span hierarchy is not available for this span.";
export const OBSERVABILITY_TREE = "Tree";
export const OBSERVABILITY_CHAT = "Chat";
export const OBSERVABILITY_TIMELINE = "Timeline";
export const OBSERVABILITY_GRAPH = "Graph";
export const OBSERVABILITY_NO_SERVER_CONNECTION = "Cannot connect to server!";
export const OBSERVABILITY_ADD = "Add";
export const OBSERVABILITY_SPAN_NAME_EXAMPLE = "e.g. SpanName";
export const OBSERVABILITY_ATTRIBUTE_KEY_EXAMPLE = "e.g. gen_ai.system";
export const OBSERVABILITY_FULL_SCREEN = "Full screen";
export const OBSERVABILITY_EVALUATION_PANEL = "Evaluation";
export const OBSERVABILITY_ROW = "row";
export const OBSERVABILITY_TRACE = "trace";
export const OBSERVABILITY_SPAN = "span";
export const OBSERVABILITY_SCOPE_META = "scope";

// Cron
export const CRON_RECURRING_TIME_INVALID =
	"Invalid cron schedule. Please check the format.";
export const CRON_JOB_UPDATION_ERROR = "Error updating cron job.";

// Manage Dashboard
export const BOARD_DATA_NOT_FOUND = "Board data not found!";
export const MANAGE_DASHBOARD_EXPLORER_EMPTY_STATE =
	"No dashboards or folders yet. Click 'Add' to create one.";
export const BOARD_UPDATE_FAILED = "Board update failed!";
export const BOARD_UPDATED_SUCCESSFULLY = "Board updated successfully!";
export const FOLDER_UPDATE_FAILED = "Folder update failed!";
export const FOLDER_UPDATED_SUCCESSFULLY = "Folder updated successfully!";
export const WIDGET_UPDATE_FAILED = "Widget update failed!";
export const WIDGET_CREATE_FAILED = "Widget create failed!";
export const WIDGET_UPDATED_SUCCESSFULLY = "Widget updated successfully!";
export const BOARD_LAYOUT_UPDATED_SUCCESSFULLY =
	"Board layout updated successfully!";
export const WIDGET_FETCH_FAILED = "Widget fetch failed!";
export const WIDGET_RUN_FAILED = "Widget run failed!";
export const BOARD_DELETE_FAILED = "Board delete failed!";
export const BOARD_DELETED_SUCCESSFULLY = "Board deleted successfully!";
export const FOLDER_DELETE_FAILED =
	"Folder cannot be deleted! It has boards or folders inside it.";
export const FOLDER_DELETED_SUCCESSFULLY = "Folder deleted successfully!";
export const MAIN_DASHBOARD_NOT_FOUND = "Main dashboard not found!";
export const BOARD_CREATE_FAILED = "Board create failed!";
export const BOARD_IMPORT_FAILED = "Board import failed!";
export const BOARD_IMPORT_SUCCESSFULLY = "Board import successfully!";
export const NO_WIDGETS_YET = "No widgets yet!";
export const NO_WIDGETS_YET_DESCRIPTION = "Create your first widget to start building your custom dashboard. Add charts, stats, and more to visualize your data.";
export const NO_WIDGETS_YET_ACTION_BUTTON = "Add Your First Widget";
export const NO_DASHBOARDS_YET = "No Dashboards Yet";
export const NO_DASHBOARDS_YET_DESCRIPTION = "Create your first dashboard to start visualizing your data in a meaningful way.";
export const NO_DASHBOARDS_YET_ACTION_BUTTON = "Create Dashboard";
export const NO_DASHBOARDS_YET_SEARCH_TITLE = "No Dashboards Found";
export const NO_DASHBOARDS_YET_SEARCH_DESCRIPTION = "No dashboards found matching your search.";
export const NO_WIDGETS_YET_SEARCH_TITLE = "No Widgets Found";
export const NO_WIDGETS_YET_SEARCH_DESCRIPTION = "No widgets found matching your search.";
export const ADD_DASHBOARD_OR_FOLDER = "Create a new dashboard or folder";
export const EDIT_DASHBOARD_OR_FOLDER = "Edit dashboard or folder";
export const ERROR_OCCURED = "Broken Dashboard";
export const ERROR_OCCURED_DESCRIPTION = "An error occurred while fetching the dashboard or the dashboard does not exist. Please try again later.";

// Openground
export const OPENGROUND_MIGRATION_FAILED = "Openground migration failed!";
export const OPENGROUND_CREATE_FAILED = "Failed to create Openground evaluation!";
export const OPENGROUND_FETCH_FAILED = "Failed to fetch Openground evaluation!";
export const OPENGROUND_DELETE_FAILED = "Failed to delete Openground evaluation!";
export const OPENGROUND_DATA_MIGRATION_FAILED = "Failed to migrate Openground data from Prisma to ClickHouse!";
export const OPENGROUND_RUN_DETAILS = "Run Details";
export const OPENGROUND_PROVIDER_RESPONSE = "Provider Response";
export const OPENGROUND_PROVIDER_RESPONSES = "Provider Responses";
export const OPENGROUND_SELECT_PROVIDERS = "Select Providers to Compare";
export const OPENGROUND_SELECT_PROVIDER_ERROR = "Please select at least one provider";
export const OPENGROUND_ENTER_PROMPT_ERROR = "Please enter a prompt";
export const OPENGROUND_FILL_VARIABLES_ERROR = "Please fill in all variables";
export const OPENGROUND_EVALUATION_SUCCESS = "Evaluation completed successfully!";
export const OPENGROUND_EVALUATION_FAILED = "Evaluation failed";
export const OPENGROUND_RESET_SUCCESS = "Reset complete. Ready for a new evaluation.";
export const OPENGROUND_EVALUATION_LOADED = "Evaluation loaded. Configure providers and run again.";
export const OPENGROUND_SELECT_PROVIDERS_BEGIN = "Select providers above to begin";
export const OPENGROUND_EVALUATION_COMPLETE = "Evaluation complete";
export const OPENGROUND_READY_TO_EVALUATE = "Ready to evaluate";
export const OPENGROUND_PROVIDER_ADDED = "added. Configure model/settings below.";
export const OPENGROUND_LOAD_CONFIG_FAILED = "Failed to load provider configurations";
export const OPENGROUND_LOAD_PROMPTS_FAILED = "Failed to load prompts from Prompt Hub";
export const OPENGROUND_LOAD_PROMPT_DETAILS_FAILED = "Failed to load prompt details";
export const OPENGROUND_LOAD_VAULT_KEYS_FAILED = "Failed to load API keys from Vault";
export const OPENGROUND_SELECT_API_KEY_ERROR = "Please select an API key from Vault";
export const OPENGROUND_SAVE_CONFIG_FAILED = "Failed to save configuration";
export const OPENGROUND_CONFIG_SAVED = "Configuration saved successfully!";
export const OPENGROUND_CONFIG_UPDATED = "Configuration updated successfully!";
export const OPENGROUND_SELECT_API_KEY = "Select an API key";
export const OPENGROUND_SELECT_DEFAULT_MODEL = "Select a default model";
export const OPENGROUND_SELECT_PROMPT = "Select a prompt from Prompt Hub";
export const OPENGROUND_SAVE_CONFIGURATION = "Save Configuration";
export const OPENGROUND_UPDATE_CONFIGURATION = "Update Configuration";
export const OPENGROUND_EVALUATING = "Evaluating...";
export const OPENGROUND_EVALUATING_PROVIDERS = "Evaluating providers...";
export const OPENGROUND_EVALUATE_PROVIDERS = "Evaluate providers";
export const OPENGROUND_MAY_TAKE_FEW_SECONDS = "This may take a few seconds";
export const OPENGROUND_CREATE_NEW_PLAYGROUND = "Create New Playground";
export const OPENGROUND_FASTEST_RESPONSE = "Fastest Response";
export const OPENGROUND_LOWEST_COST = "Lowest Cost";
export const OPENGROUND_MOST_EFFICIENT = "Most Efficient";
export const OPENGROUND_SUCCESS_RATE = "Success Rate";
export const OPENGROUND_PROMPT_CONFIGURATION = "Prompt Configuration";
export const OPENGROUND_CUSTOM = "Custom";
export const OPENGROUND_PROMPT_HUB = "Prompt Hub";
export const OPENGROUND_ENTER_PROMPT_PLACEHOLDER = "Enter your prompt... Use {{variable}} for dynamic values";
export const OPENGROUND_NO_PROMPTS_FOUND = "No prompts found in Prompt Hub";
export const OPENGROUND_LOADING_PROMPT_DETAILS = "Loading prompt details...";
export const OPENGROUND_RAW_RESPONSE_DATA = "Raw Response Data";
export const OPENGROUND_RESPONSE_TIME_COMPARISON = "Response Time Comparison";
export const OPENGROUND_RESPONSE_TIME_COMPARISON_DESCRIPTION = "Visual comparison of provider response times";
export const OPENGROUND_COST_BREAKDOWN = "Cost Breakdown";
export const OPENGROUND_COST_BREAKDOWN_DESCRIPTION = "Detailed cost analysis per provider";
export const OPENGROUND_CLICK_PROVIDER_CARD_TO_CHANGE_MODEL_OR_SETTINGS = "Click a provider card to change model or settings";
export const OPENGROUND_UPDATE = "Update";
export const OPENGROUND_LINK_PROVIDER_TO_VAULT_DESCRIPTION = "Link this provider to an API key from your Vault and optionally set a default model";
export const OPENGROUND_API_KEY_FROM_VAULT = "API Key (from Vault)";
export const OPENGROUND_LOADING_SECRETS = "Loading secrets...";
export const OPENGROUND_NO_API_KEYS_FOUND_IN_VAULT = "No API keys found in Vault.";
export const OPENGROUND_CREATE_NEW_API_KEY = "Create New API Key";
export const OPENGROUND_API_KEY_STORED_IN_VAULT = "API key stored in Vault";
export const OPENGROUND_DEFAULT_MODEL_OPTIONAL = "Default Model (Optional)";
export const OPENGROUND_YOU_CAN_CHANGE_PER_EVALUATION = "You can change this per evaluation";
export const OPENGROUND_API_KEY_REFERENCE_SAVED_INFO = "The API key reference is saved in ClickHouse. The actual key remains encrypted in Vault.";
export const OPENGROUND_PROVIDER_SETTINGS = "Provider Settings";
export const OPENGROUND_MODEL = "Model";
export const OPENGROUND_TEMPERATURE = "Temperature";
export const OPENGROUND_TEMPERATURE_DESCRIPTION = "Controls randomness: lower is more focused, higher is more creative";
export const OPENGROUND_MAX_TOKENS = "Max Tokens";
export const OPENGROUND_MAX_TOKENS_DESCRIPTION = "Maximum length of the response";
export const OPENGROUND_TOP_P = "Top P";
export const OPENGROUND_TOP_P_DESCRIPTION = "Nucleus sampling: controls diversity of word choice";
export const OPENGROUND_ENTER_VALUE_FOR = "Enter value for";
export const OPENGROUND_VARIABLES_SUBSTITUTED_INFO = "These values will be substituted into your prompt before evaluation";
export const OPENGROUND_CUSTOM_MODEL = "Custom Model";
export const OPENGROUND_ENTER_CUSTOM_MODEL_NAME = "Enter custom model name";
export const OPENGROUND_USE_CUSTOM_MODEL = "Use Custom Model";
export const OPENGROUND_OR_ENTER_CUSTOM = "or enter custom";
export const OPENGROUND_MANAGE_MODELS = "Manage Models";
export const OPENGROUND_ADD_NEW_MODEL = "Add New Model";
export const OPENGROUND_EDIT_MODEL = "Edit Model";
export const OPENGROUND_MODEL_ID = "Model ID";
export const OPENGROUND_MODEL_DISPLAY_NAME = "Display Name";
export const OPENGROUND_CONTEXT_WINDOW = "Context Window";
export const OPENGROUND_INPUT_PRICE_PER_M_TOKENS = "Input Price (per 1M tokens)";
export const OPENGROUND_OUTPUT_PRICE_PER_M_TOKENS = "Output Price (per 1M tokens)";
export const OPENGROUND_MODEL_CAPABILITIES = "Capabilities (comma separated)";
export const OPENGROUND_SAVE_MODEL = "Save Model";
export const OPENGROUND_MODEL_SAVED_SUCCESS = "Model saved successfully!";
export const OPENGROUND_MODEL_DELETED_SUCCESS = "Model deleted successfully!";
export const OPENGROUND_DELETE_MODEL = "Delete Model";
export const OPENGROUND_DELETE_MODEL_CONFIRMATION = "Are you sure you want to delete this model?";
export const OPENGROUND_NO_CUSTOM_MODELS_YET = "No custom models added yet. Add one to get started.";
export const OPENGROUND_MANAGE_MODELS_DESCRIPTION = "View and manage custom models for all providers. Add new models or clone existing ones with custom pricing.";
export const OPENGROUND_SELECT_MODEL_TO_VIEW = "Select a model to view details";
export const OPENGROUND_SELECT_MODEL_TO_VIEW_DESCRIPTION = "Choose a model from the sidebar to view its details, or add a new custom model for any provider.";
export const OPENGROUND_STATIC_MODEL = "Static Model";
export const OPENGROUND_STATIC_MODEL_DESCRIPTION = "This is a built-in model. Clone it to create a custom version with your own pricing.";
export const OPENGROUND_CLONE_MODEL = "Clone Model";
export const OPENGROUND_MODEL_DETAILS = "Model Details";
export const OPENGROUND_ADD_CUSTOM_MODEL = "Add Custom Model";
export const OPENGROUND_EDIT_CUSTOM_MODEL = "Edit Custom Model";
export const OPENGROUND_ALL_PROVIDERS = "All Providers";
export const OPENGROUND_SEARCH_MODELS = "Search models...";
export const OPENGROUND_NO_MODELS_FOUND = "No models found";
export const OPENGROUND_CUSTOM_MODELS = "Custom Models";
export const MANAGE_MODELS_EXPORT_PRICING = "Export Pricing";
export const MANAGE_MODELS_IMPORT_PRICING = "Import Pricing JSON";
export const MANAGE_MODELS_IMPORT_SUCCESS = "Import complete";
export const MANAGE_MODELS_IMPORT_FAILED = "Import failed";
export const MANAGE_MODELS_PRICING_URL_LABEL = "SDK Pricing URL";
export const MANAGE_MODELS_PRICING_URL_DESCRIPTION =
	"Use this URL in your OpenLIT SDK to load pricing from this database. The endpoint is public and does not require authentication.";
export const MANAGE_MODELS_PRICING_URL_COPIED = "URL copied to clipboard";
export const MANAGE_MODELS_IMPORT_DIALOG_TITLE = "Import Pricing JSON";
export const MANAGE_MODELS_IMPORT_DIALOG_DESCRIPTION =
	"Paste a pricing JSON (SDK format or structured models array). Existing models with the same provider + model ID are skipped.";
export const MANAGE_MODELS_SDK_USAGE = "SDK Usage";
export const MANAGE_MODELS_SDK_USAGE_DIALOG_TITLE =
	"Use this pricing in your OpenLIT SDK";
export const MANAGE_MODELS_SDK_USAGE_DIALOG_DESCRIPTION =
	"Pass this public URL to pricing_json in openlit.init() and your SDK will use the model pricing from Manage Models. No API key required.";
export const MANAGE_MODELS_SDK_USAGE_NOTE_LABEL = "Note:";
export const MANAGE_MODELS_SDK_USAGE_NOTE =
	"The SDK fetches this URL on startup. If you update a model's price here, it will be applied to future tracing.";
export const COPY = "Copy";
export const MANAGE_MODELS_INVALID_JSON = "Invalid JSON";

// Provider management
export const MANAGE_PROVIDERS_ADD = "Add Provider";
export const MANAGE_PROVIDERS_EDIT = "Edit Provider";
export const MANAGE_PROVIDERS_DELETE = "Delete Provider";
export const MANAGE_PROVIDERS_DELETE_CONFIRM =
	"This will delete the provider and all its models. Are you sure?";
export const MANAGE_PROVIDERS_SAVED = "Provider saved";
export const MANAGE_PROVIDERS_DELETED = "Provider deleted";
export const MANAGE_PROVIDERS_SAVE_FAILED = "Failed to save provider";
export const MANAGE_PROVIDERS_DELETE_FAILED = "Failed to delete provider";
export const MANAGE_PROVIDERS_ID_LABEL = "Provider ID";
export const MANAGE_PROVIDERS_ID_HINT =
	"Lowercase identifier (e.g. my-provider). Must match what the SDK sends in gen_ai.system.";
export const MANAGE_PROVIDERS_DISPLAY_NAME = "Display Name";
export const MANAGE_PROVIDERS_DESCRIPTION = "Description";
export const MANAGE_PROVIDERS_REQUIRES_VAULT = "Requires API Key (Vault)";

// Pricing
export const PRICING_TITLE = "Pricing";
export const PRICING_PAGE_DESCRIPTION =
	"Recalculate the cost of LLM traces using the current model pricing in Manage Models. Updates the `gen_ai.usage.cost` attribute on existing traces.";
export const PRICING_INFO_BAR =
	"Pricing is computed from the input/output token counts on the trace and the per-million-token price stored for each model in Manage Models. Edit a model there to update what auto/manual pricing computes.";
export const PRICING_AUTO_TITLE = "Auto Pricing";
export const PRICING_AUTO_DESCRIPTION =
	"Recompute pricing on a schedule for new LLM traces.";
export const PRICING_AUTO_ENABLE_LABEL = "Enable Auto Pricing";
export const PRICING_AUTO_ENABLE_HINT =
	"Periodically recompute and store pricing for new traces.";
export const PRICING_AUTO_CRON_LABEL = "Cron Schedule";
export const PRICING_AUTO_CRON_PLACEHOLDER = "*/15 * * * *";
export const PRICING_AUTO_CRON_HELP =
	"Standard cron expression. Example: */15 * * * * runs every 15 minutes.";
export const PRICING_MANUAL_TITLE = "Manual Pricing";
export const PRICING_MANUAL_DESCRIPTION =
	"Recalculate the cost for a specific trace on demand.";
export const PRICING_MANUAL_STEP_1 = "Open any LLM request in the trace explorer.";
export const PRICING_MANUAL_STEP_2 =
	'Click "Recalculate Cost" in the trace detail panel.';
export const PRICING_MANUAL_STEP_3 =
	"The gen_ai.usage.cost attribute is updated using the latest model pricing.";
export const PRICING_GO_TO_REQUESTS = "Go to Requests";
export const PRICING_SAVE = "Save";
export const PRICING_UPDATE = "Update";
export const PRICING_CONFIG_SAVED = "Pricing config saved";
export const PRICING_HOW_AUTO_WORKS_TITLE = "How Auto Pricing Works";
export const PRICING_HOW_AUTO_WORKS_DESCRIPTION =
	"On each cron tick, OpenLIT selects LLM spans from otel_traces, looks up each span's provider + model in openlit_provider_models, recomputes the cost from token counts, and writes it back to gen_ai.usage.cost.";
export const PRICING_HOW_AUTO_WORKS_STEP_1 =
	"Selects LLM spans: spans whose gen_ai.operation.name matches supported LLM operations (e.g. chat).";
export const PRICING_HOW_AUTO_WORKS_STEP_2 =
	"Incremental window: only spans with Timestamp >= the last successful cron run are processed. First run processes all historical LLM spans.";
export const PRICING_HOW_AUTO_WORKS_STEP_3 =
	"Looks up the model: for each span, reads gen_ai.system (provider) + gen_ai.request.model and finds the matching row in openlit_provider_models.";
export const PRICING_HOW_AUTO_WORKS_STEP_4 =
	"Computes cost: (input_tokens / 1M) × input_price_per_m_token + (output_tokens / 1M) × output_price_per_m_token.";
export const PRICING_HOW_AUTO_WORKS_STEP_5 =
	"Writes back: ALTER TABLE otel_traces UPDATE SpanAttributes['gen_ai.usage.cost'] for each processed span. Spans with missing provider/model/tokens or an unknown model are skipped (not errors).";
export const PRICING_HOW_AUTO_WORKS_STEP_6 =
	"Run is logged: totalSpans, totalUpdated, totalFailed, totalSkipped are recorded in the cron log with SUCCESS / PARTIAL_SUCCESS / FAILURE status.";

// Recalculate Cost (in trace detail panel)
export const RECALCULATE_COST_LABEL = "Recalculate Cost";
export const RECALCULATE_COST_UPDATING = "Updating…";
export const RECALCULATE_COST_TITLE =
	"Recalculate cost using the model's price in Manage Models";
export const RECALCULATE_COST_SUCCESS = "Cost updated";
export const RECALCULATE_COST_FAILURE =
	"Could not update cost — model not found in Manage Models or pricing unavailable";
export const RECALCULATE_COST_REQUEST_FAILED = "Failed to recalculate cost";

// Features Title
export const FEATURE_OPENGROUND = "Openground";
export const FEATURE_PROMPTS = "Prompt Hub";
export const FEATURE_VAULT = "Vault";
export const FEATURE_FLEET_HUB = "Fleet Hub";

// Agents
export const AGENTS_FILTER_SYSTEM = "System";
export const AGENTS_FILTER_PROVIDER = "Provider";
export const AGENTS_FILTER_STATUS = "Status";
export const AGENTS_FILTER_STATUS_DISCOVERED = "Discovered";
export const AGENTS_FILTER_STATUS_INSTRUMENTED = "Instrumented";
export const AGENTS_FILTER_CONTROLLER_HEALTH = "Health";
export const AGENTS_FILTER_CONTROLLER_ACTIVE = "Active";
export const AGENTS_FILTER_CONTROLLER_HEALTHY = "Healthy";
export const AGENTS_FILTER_CONTROLLER_DEGRADED = "Degraded";
export const AGENTS_FILTER_CONTROLLER_STALE = "Stale";
export const AGENTS_FILTER_CONTROLLER_ERROR = "Error";
export const AGENTS_CLEAR_FILTERS = "Clear Filters";
export const AGENTS_APPLY_FILTERS = "Apply Filters";
export const AGENTS_SYSTEM_KUBERNETES = "Kubernetes";
export const AGENTS_SYSTEM_DOCKER = "Docker";
export const AGENTS_SYSTEM_LINUX = "Linux";
export const AGENTS_STAT_CONTROLLERS = "Active Controllers";
export const AGENTS_STAT_DISCOVERED_SERVICES = "Discovered Agents";
export const AGENTS_STAT_INSTRUMENTED_SERVICES = "Instrumented Agents";
export const AGENTS_STAT_CODING_VENDORS = "Total Coding Agents";
export const AGENTS_STAT_CODING_COST = "Total Cost";
export const AGENTS_STAT_CODING_USERS = "Total Users";
export const AGENTS_TAB_SERVICES = "Applications";
export const AGENTS_TAB_CONTROLLERS = "Controllers";
export const AGENTS_TAB_CODING = "Coding Agents";
export const AGENTS_ADD_CONTROLLER = "Add Controller";
export const AGENTS_ADD_CODING_AGENT = "Add Coding Agent";
export const AGENTS_NO_CODING_AGENTS_DESCRIPTION = "Pick a tool to see the install snippet. The OpenLit CLI hooks into the agent and ships every session, tool call, and LLM turn to this stack — no SDK or code changes required.";

// Trace-detail content-capture banner. Surfaces a one-liner the user
// can run when prompts / responses are missing from a coding-agent
// trace (i.e. the CLI is in metadata_only or minimal mode). Tracks the
// OPENLIT_CODING_CONTENT_CAPTURE flag used by the CLI.
export const CODING_AGENT_CONTENT_CAPTURE_NOTE_TITLE = "Content capture is off";
export const CODING_AGENT_CONTENT_CAPTURE_NOTE_COMMAND =
	"openlit configure --content-capture full";

// Agents - No Controller
export const AGENTS_NO_CONTROLLERS_TITLE = "No controllers detected";
export const AGENTS_NO_CONTROLLERS_DESCRIPTION = "Install the OpenLIT Controller to automatically discover and instrument LLM API calls using eBPF.";
export const AGENTS_API_KEY_PREFILLED_MESSAGE = "Commands below are pre-filled with your API key and dashboard URL. The controller will authenticate automatically.";
export const AGENTS_API_KEY_RECOMMENDED_PREFIX = "Recommended:";
export const AGENTS_API_KEY_RECOMMENDED_BEFORE_LINK = " Create an API key in ";
export const AGENTS_API_KEY_RECOMMENDED_LINK_TEXT = "Settings → API Keys";
export const AGENTS_API_KEY_RECOMMENDED_AFTER_LINK = " to secure your controller connection. Once created, refresh this page to see pre-filled commands.";
export const AGENTS_COPY_TO_CLIPBOARD = "Copy to clipboard";

// Agents - Service Table
export const AGENTS_SERVICE_PID_PREFIX = "PID";
export const AGENTS_SERVICE_ACTION_DISABLING = "Disabling...";
export const AGENTS_SERVICE_ACTION_ENABLING = "Enabling...";
export const AGENTS_SERVICE_ACTION_WORKING = "Working...";
export const AGENTS_SERVICE_ACTION_DISABLE = "Disable";
export const AGENTS_SERVICE_ACTION_ENABLE = "Enable";
export const AGENTS_SERVICE_ACTION_ELLIPSIS = "...";
export const AGENTS_SERVICE_MANUAL_BADGE = "Manual";
export const AGENTS_SERVICE_QUEUED_ACTION = (action: string, serviceName: string) => `Queued ${action} for ${serviceName}`;
export const AGENTS_SERVICE_FAILED = (err: string) => `Failed: ${err}`;
export const AGENTS_AGENT_ENABLING_FOR = (serviceName: string) => `Enabling Agent Observability for ${serviceName}`;
export const AGENTS_AGENT_DISABLING_FOR = (serviceName: string) => `Disabling Agent Observability for ${serviceName}`;
export const AGENTS_PODS_ACK_PROGRESS = (ack: number, total: number) =>
	`Pods: ${ack}/${total} acknowledged`;
export const AGENTS_COLUMN_SERVICE = "Name";
export const AGENTS_COLUMN_SYSTEM = "System";
export const AGENTS_COLUMN_PROVIDERS = "Providers";
// Coding-agent stat / column labels intentionally omit a window
// suffix (no "24h"). The underlying data is always evaluated
// against the global filter picker's selected time range — fixed-24h
// language would be misleading once the user picks 7D / 1M / CUSTOM.
export const AGENTS_CODING_USERS_WINDOW_LABEL = "Active users";
export const AGENTS_CODING_COST_WINDOW_LABEL = "Cost (USD)";
export const AGENTS_CODING_COLUMN_VENDOR = "Vendor";
export const AGENTS_CODING_COLUMN_SESSIONS = "Sessions";
export const AGENTS_CODING_COLUMN_USERS = "Users";
export const AGENTS_CODING_COLUMN_COST = "Cost";
export const AGENTS_CODING_COLUMN_LINES = "Lines";
export const AGENTS_CODING_COLUMN_ACCEPTANCE = "Acceptance";
export const AGENTS_CODING_COLUMN_COMMITS = "Commits";
export const AGENTS_CODING_COLUMN_PRS = "PRs";
export const AGENTS_CODING_EMPTY_TITLE = "No coding agents yet";
export const AGENTS_CODING_EMPTY_BODY =
	"Install the openlit CLI on a teammate's machine and run a Claude Code, Cursor, or Codex session. The first hook event will surface the agent here within a minute.";
export const AGENTS_CODING_TAB_SESSIONS = "Sessions";
export const AGENTS_CODING_SESSIONS_EMPTY = "No sessions in the selected time range.";
export const AGENTS_CODING_SESSIONS_SESSION = "Session";
export const AGENTS_CODING_SESSIONS_USER = "User";
export const AGENTS_CODING_SESSIONS_STARTED = "Started";
export const AGENTS_CODING_SESSIONS_DURATION = "Duration";
export const AGENTS_CODING_SESSIONS_TOOLS = "Tools";
export const AGENTS_CODING_SESSIONS_COST = "Cost";
export const AGENTS_CODING_SESSIONS_CODE = "Lines (+/−)";
export const AGENTS_CODING_SESSIONS_ACCEPTANCE = "Accept %";
export const AGENTS_CODING_SESSIONS_COMMITS = "Commits";
export const AGENTS_CODING_SESSIONS_PRS = "PRs";
export const AGENTS_CODING_SESSIONS_OUTCOME = "Outcome";
export const AGENTS_CODING_SESSIONS_CLASSIFICATION = "Classification";
export const AGENTS_CODING_SESSIONS_LABEL = "Coding sessions";
export const AGENTS_CODING_SESSIONS_SHORT_LABEL = "Sessions";
export const AGENTS_CODING_SESSIONS_SUMMARY = "Per-session timeline of coding-agent runs (Cursor, Claude Code, Codex).";
export const AGENTS_CODING_USERS_LABEL = "Coding users";
export const AGENTS_CODING_USERS_SHORT_LABEL = "Users";
export const AGENTS_CODING_USERS_SUMMARY = "Per-user roll-up of coding-agent activity.";
export const AGENTS_CODING_USERS_LINES = "Lines added";
export const AGENTS_CODING_USERS_ACCEPTANCE = "Accept %";
export const AGENTS_CODING_USERS_COMMITS = "Commits";
export const AGENTS_CODING_USERS_PRS = "PRs";
export const AGENTS_CODING_DASHBOARD_NOT_SEEDED =
	"Dashboard not yet available. Restart the openlit container to run the latest seed migrations.";
export const AGENTS_CODING_DASHBOARD_OPEN = "Open full dashboard";
export const AGENTS_COLUMN_LAST_SEEN = "Last Seen";
export const AGENTS_COLUMN_LLM_OBSERVABILITY = "LLM Observability";
export const AGENTS_COLUMN_AGENT_OBSERVABILITY = "Agent Observability";
export const AGENTS_COLUMN_SOURCE = "Source";
export const AGENTS_SOURCE_CONTROLLER = "Controller";
export const AGENTS_SOURCE_SDK = "SDK";
export const AGENTS_SOURCE_BOTH = "Controller + SDK";
export const AGENTS_FILTER_STATUS_SDK = "SDK-instrumented";
export const AGENTS_SDK_ENABLED_VIA = "Enabled (via SDK)";
export const AGENTS_SDK_SOURCE_NOTE = "Source: SDK";
export const AGENTS_LOAD_MORE = "Load more";
export const AGENTS_LOAD_MORE_LOADING = "Loading...";

// Agents - Lifecycle (Play / Stop / Restart for controller-managed workloads)
export const AGENTS_COLUMN_ACTIONS = "Actions";
export const AGENTS_LIFECYCLE_PLAY = "Play";
export const AGENTS_LIFECYCLE_STOP = "Stop";
export const AGENTS_LIFECYCLE_RESTART = "Restart";
export const AGENTS_LIFECYCLE_STARTING = "Starting...";
export const AGENTS_LIFECYCLE_STOPPING = "Stopping...";
export const AGENTS_LIFECYCLE_RESTARTING = "Restarting...";
export const AGENTS_LIFECYCLE_STATUS_RUNNING = "Running";
export const AGENTS_LIFECYCLE_STATUS_STOPPED = "Stopped";
export const AGENTS_LIFECYCLE_STATUS_RESTARTING = "Restarting";
export const AGENTS_LIFECYCLE_STATUS_UNKNOWN = "Unknown";
export const AGENTS_LIFECYCLE_TOOLTIP_PLAY = "Start the agent (scale up / start container / re-launch process)";
export const AGENTS_LIFECYCLE_TOOLTIP_STOP = "Stop the agent (scale to 0 / stop container / SIGTERM)";
export const AGENTS_LIFECYCLE_TOOLTIP_RESTART = "Restart the agent (rolling restart / restart container / SIGTERM + relaunch)";
export const AGENTS_LIFECYCLE_TOOLTIP_DISABLED_SDK = "Lifecycle controls are available only for controller-managed agents.";
export const AGENTS_LIFECYCLE_TOOLTIP_DISABLED_CAPABILITY = "The controller managing this agent does not advertise lifecycle support yet.";
export const AGENTS_LIFECYCLE_TOOLTIP_PLAY_NO_SNAPSHOT = "No saved snapshot to restore. The controller cannot bring this agent back up without state captured at Stop time.";
export const AGENTS_LIFECYCLE_CONFIRM_STOP_TITLE = "Stop agent?";
export const AGENTS_LIFECYCLE_CONFIRM_STOP_DESCRIPTION = (serviceName: string) =>
	`This will scale down or terminate the agent "${serviceName}". Telemetry will stop until you Play it again.`;
export const AGENTS_LIFECYCLE_CONFIRM_STOP_CONFIRM = "Stop agent";
export const AGENTS_LIFECYCLE_CONFIRM_STOP_CANCEL = "Cancel";
export const AGENTS_LIFECYCLE_QUEUED_PLAY = (serviceName: string) =>
	`Starting ${serviceName}...`;
export const AGENTS_LIFECYCLE_QUEUED_STOP = (serviceName: string) =>
	`Stopping ${serviceName}...`;
export const AGENTS_LIFECYCLE_QUEUED_RESTART = (serviceName: string) =>
	`Restarting ${serviceName}...`;
export const AGENTS_LIFECYCLE_FAILED = (err: string) => `Lifecycle action failed: ${err}`;
export const AGENTS_OBSERVABILITY_DISABLED_NOT_RUNNING =
	"Start the agent to change observability — toggling LLM / Agent observability is only possible while the agent is running.";
export const AGENTS_OBSERVABILITY_DISABLED_TRANSITIONING =
	"Observability changes are blocked while the agent is starting, stopping, or restarting.";
export const AGENTS_LIFECYCLE_DISABLED_OBSERVABILITY_TRANSITIONING =
	"Lifecycle changes are blocked while LLM or Agent observability is being applied to this agent.";

// Agents - Detail Tabs
export const AGENTS_TAB_ANALYTICS = "Analytics";
export const AGENTS_TAB_CONVERSATIONS = "Conversations";
export const AGENTS_TAB_DEFINITION = "Definition";

// Agents - Redesigned detail page tabs (6-tab shell)
export const AGENTS_TAB_OVERVIEW = "Overview";
export const AGENTS_TAB_DASHBOARD = "Dashboard";
export const AGENTS_TAB_MONITORING = "Monitoring";
export const AGENTS_TAB_CONFIGURATION = "Configuration";
export const AGENTS_TAB_CONFIGURATION_NEEDS_INSTRUMENTATION =
	"Instrumentation required — no data received";
export const AGENTS_TAB_TOOLS = "Tools";
export const AGENTS_TAB_PROMPTS = "Prompts";

// Agents - Version Timeline (bar chart + chooser)
export const AGENTS_VERSION_TIMELINE_TITLE = "Version Timeline";
export const AGENTS_VERSION_TIMELINE_EMPTY = "No traffic in the selected window yet.";
export const AGENTS_VERSION_TIMELINE_ALL_VERSIONS = "All versions";
export const AGENTS_VERSION_RECENT_LABEL = "Recent versions";
export const AGENTS_VERSION_TIMELINE_REQ_COUNT = (count: number) =>
	`${count.toLocaleString()} ${count === 1 ? "request" : "requests"}`;
export const AGENTS_DAG_TITLE = "Call Graph";
export const AGENTS_DAG_EMPTY = "No spans captured yet for this version.";
export const AGENTS_DAG_SAMPLED_NOTE = (sampled: number, total: number) =>
	`Aggregated from ${sampled.toLocaleString()} of ${total.toLocaleString()} traces.`;
export const AGENTS_CONFIGURATION_DESCRIPTION =
	"Controls for instrumenting this agent and toggling the controller agent observability flag.";

// Agents - Definition / Versions
export const AGENTS_DEFINITION_SYSTEM_PROMPT = "System Prompt";
export const AGENTS_DEFINITION_TOOLS = "Tools";
export const AGENTS_DEFINITION_NO_SYSTEM_PROMPT = "No system prompt captured yet. The agent has not emitted gen_ai.system_instructions.";
export const AGENTS_DEFINITION_NO_TOOLS = "No tools captured yet. The agent has not emitted gen_ai.tool.definitions or gen_ai.tool.name.";
export const AGENTS_DEFINITION_COPY = "Copy";
export const AGENTS_DEFINITION_COPIED = "Copied";
export const AGENTS_DEFINITION_SHOW_DIFF = "Show diff vs previous version";
export const AGENTS_DEFINITION_HIDE_DIFF = "Hide diff";
export const AGENTS_DEFINITION_SCHEMA = "Schema";
export const AGENTS_DEFINITION_SCHEMA_NOT_CAPTURED =
	"This tool was reported by name only — its parameter schema was not captured by the instrumentation.";
export const AGENTS_DEFINITION_VIEW_RAW = "View raw";
export const AGENTS_DEFINITION_VIEW_FORMATTED = "View formatted";
export const AGENTS_VERSION_CURRENT = "Current";
export const AGENTS_VERSION_NUMBER_PREFIX = "v";
export const AGENTS_VERSION_SELECTOR_LABEL = "Version";
export const AGENTS_VERSION_DRAWER_TITLE = "Version History";
export const AGENTS_VERSION_FIRST_SEEN = "First seen";
export const AGENTS_VERSION_LAST_SEEN = "Last seen";
export const AGENTS_VERSION_REQUESTS = "Requests";
export const AGENTS_VERSION_FINGERPRINT = "Fingerprint";
export const AGENTS_VERSION_NO_HISTORY = "No version history yet.";

// Agents - Detail Metadata
export const AGENTS_METADATA_PRIMARY_MODEL = "Primary Model";
export const AGENTS_METADATA_MODELS = "Models";
export const AGENTS_METADATA_TOOLS = "Tools";
export const AGENTS_METADATA_AGE = "Age";
export const AGENTS_METADATA_LAST_SEEN = "Last Seen";
export const AGENTS_METADATA_REQUESTS_24H = "Requests (24h)";
export const AGENTS_REFRESH = "Refresh";
export const AGENTS_REFRESHING = "Refreshing...";
export const AGENTS_LAST_UPDATED = (seconds: number) => `Updated ${seconds}s ago`;
export const AGENTS_LAST_UPDATED_NEVER = "Not yet materialized";
export const AGENTS_SOURCE_SDK_LABEL = "SDK-instrumented (status reported by the agent)";

// Agents - Detail Scope
export const AGENTS_SCOPED_TO_SERVICE = (serviceName: string) =>
	`Scoped to service "${serviceName}"`;

// Agents - Controller Table
export const AGENTS_COLUMN_CONTROLLER = "Controller";
export const AGENTS_COLUMN_METADATA = "Metadata";
export const AGENTS_COLUMN_SERVICES = "Agents";
export const AGENTS_COLUMN_STATUS = "Status";
export const AGENTS_SERVICES_DISCOVERED_COUNT = (discovered: number) => `${discovered} discovered`;
export const AGENTS_SERVICES_INSTRUMENTED_COUNT = (instrumented: number) => ` / ${instrumented} instrumented`;
export const AGENTS_METADATA_NODE_LABEL = "node:";
export const AGENTS_METADATA_NS_LABEL = "ns:";
export const AGENTS_METADATA_POD_LABEL = "pod:";

// Agents - Service Detail
export const AGENTS_SERVICE_DETAIL_DEFAULT_TITLE = "Service Detail";
export const AGENTS_BACK_TO_HUB = "Back to Hub";
export const AGENTS_LOADING_SERVICE_DETAILS = "Loading service details...";
export const AGENTS_LOADING_DASHBOARD = "Loading dashboard...";
export const AGENTS_LOADING_REQUESTS = "Loading requests...";
export const AGENTS_LOADING_CONFIGURATION = "Loading configuration...";
export const AGENTS_LOADING_VERSIONS = "Loading…";
export const AGENTS_LOAD_MORE_VERSIONS = "Load more versions";
export const AGENTS_STATUS_INSTRUMENTED = "Instrumented";
export const AGENTS_STATUS_DISCOVERED = "Discovered";
export const AGENTS_STAT_PROVIDERS = "Providers";
export const AGENTS_STAT_PID = "PID";
export const AGENTS_STAT_RUNTIME = "Runtime";
export const AGENTS_STAT_FIRST_SEEN = "First Seen";
export const AGENTS_STAT_RUNTIME_UNKNOWN = "Unknown";
export const AGENTS_RESOURCE_ATTRIBUTES = "Resource Attributes";
export const AGENTS_CONTROLS = "Controls";
export const AGENTS_LLM_OBSERVABILITY_LABEL = "LLM Observability";
export const AGENTS_LLM_OBSERVABILITY_DESCRIPTION = "Enable eBPF-based observability for LLM and VectorDB traffic — RED metrics, model name, tokens, and tool calls.";
export const AGENTS_AGENT_OBSERVABILITY_LABEL = "Agent Observability";
export const AGENTS_AGENT_OBSERVABILITY_DESCRIPTION = "Injects the OpenLIT agent SDK for LangChain, LangGraph, CrewAI, and similar agent frameworks.";
export const AGENTS_AGENT_ACTION_DOCKER = "Requires container recreate.";
export const AGENTS_AGENT_ACTION_LINUX = "Requires systemd service restart.";
export const AGENTS_AGENT_ACTION_K8S = "Triggers a rolling update.";
export const AGENTS_CURRENTLY_PREFIX = "Currently ";
export const AGENTS_CHECKING_STATUS = "checking status";
export const AGENTS_DEPLOYING_IN_PROGRESS = "deploying (rolling update in progress)";
export const AGENTS_REMOVING_IN_PROGRESS = "removing (rolling update in progress)";
export const AGENTS_ENABLED = "enabled";
export const AGENTS_DISABLED = "disabled";
export const AGENTS_AGENT_USE_NOTE = "Use this only for agent framework spans. Provider-level LLM traffic still comes from eBPF.";
export const AGENTS_SDK_VERSION_LABEL = "SDK version:";
export const AGENTS_MANUAL_SETUP_REQUIRED = "Manual setup required";
export const AGENTS_CONTAINERIZED_WARNING = "This process runs inside a container. Mount the Docker socket or use a Docker/Kubernetes-mode controller for Agent Observability.";
export const AGENTS_NAKED_POD_WARNING = "This is a naked pod (no Deployment, DaemonSet, or StatefulSet). Enabling or disabling Agent Observability will restart the pod.";
export const AGENTS_NAKED_POD_CONFIRM = "This pod has no Deployment or DaemonSet. Enabling Agent Observability will restart the pod. Continue?";
export const AGENTS_AGENT_DEPLOY_QUEUED = "Agent observability is being deployed. The agent will be updated automatically.";
export const AGENTS_AGENT_REMOVE_QUEUED = "Agent observability removal queued. The agent will be updated automatically.";
export const AGENTS_QUEUED_ACTION = (action: string) => `Queued ${action}`;
export const AGENTS_PENDING_INSTRUMENTING = "Instrumenting";
export const AGENTS_PENDING_UNINSTRUMENTING = "Uninstrumenting";
export const AGENTS_PENDING_ENABLING_AGENT = "Enabling Agent Observability";
export const AGENTS_PENDING_DISABLING_AGENT = "Disabling Agent Observability";
export const AGENTS_PENDING_WORKING = "Working";
export const AGENTS_AGENT_TOGGLE_CHECKING = "Checking...";
export const AGENTS_AGENT_TOGGLE_DEPLOYING = "Deploying...";
export const AGENTS_AGENT_TOGGLE_REMOVING = "Removing...";
export const AGENTS_AGENT_TOGGLE_CONFLICT = "Conflict detected";
export const AGENTS_AGENT_TOGGLE_UNAVAILABLE = "Unavailable";
export const AGENTS_AGENT_TOGGLE_DOCKER_NEEDED = "Docker access needed";
export const AGENTS_AGENT_TOGGLE_NOT_MANAGEABLE = "Not manageable";
export const AGENTS_AGENT_TOGGLE_CONTROLLER_UPGRADE = "Controller upgrade needed";
export const AGENTS_ACTION_WORKING_ELLIPSIS = "Working...";
export const AGENTS_ACTION_FAILED = "Action Failed";
export const AGENTS_LAST_ERROR_INSTRUMENT = "Instrument";
export const AGENTS_LAST_ERROR_UNINSTRUMENT = "Uninstrument";
export const AGENTS_LAST_ERROR_ENABLE_AGENT = "Enable Agent Observability";
export const AGENTS_LAST_ERROR_DISABLE_AGENT = "Disable Agent Observability";
export const AGENTS_LAST_ERROR_ACTION = "Action";
export const AGENTS_SERVICE_INFO = "Service Info";
export const AGENTS_OPEN_PORTS = "Open Ports";
export const AGENTS_EXECUTABLE = "Executable";
export const AGENTS_LAST_SEEN_PREFIX = "Last seen ";
export const AGENTS_WORKING_SUFFIX = (label: string) => `${label}...`;

// Agents - Controller Detail
export const AGENTS_CONTROLLER_DEFAULT_TITLE = "Controller";
export const AGENTS_LOADING_CONTROLLER = "Loading controller...";
export const AGENTS_LAST_HEARTBEAT_PREFIX = "Last heartbeat ";
export const AGENTS_STAT_SERVICES_DISCOVERED = "Agents Discovered";
export const AGENTS_STAT_INSTRUMENTED = "Instrumented";
export const AGENTS_CONFIG_SAVED = "Configuration saved. Controller will pick it up on next poll.";
export const AGENTS_CONFIG_SAVE_FAILED = (err: string) => `Failed to save config: ${err}`;
export const AGENTS_LOADING_CONFIG = "Loading configuration...";
export const AGENTS_SAVING = "Saving...";
export const AGENTS_SAVE_CONFIGURATION = "Save Configuration";
export const AGENTS_CONFIG_GENERAL = "General";
export const AGENTS_CONFIG_ENVIRONMENT = "Environment";
export const AGENTS_CONFIG_ENVIRONMENT_PLACEHOLDER = "default";
export const AGENTS_CONFIG_ENVIRONMENT_HELP = "Sets deployment.environment on all traces (matches OpenLIT SDK convention)";
export const AGENTS_CONFIG_POLL_INTERVAL = "Poll Interval (seconds)";
export const AGENTS_CONFIG_POLL_INTERVAL_HELP = "How often the controller polls for updates and reports services. Lower values mean faster action response but more load. (5-300s)";
export const AGENTS_CONFIG_EXPORT_SETTINGS = "Export Settings";
export const AGENTS_CONFIG_OTLP_ENDPOINT = "OTLP Endpoint";
export const AGENTS_CONFIG_OTLP_ENDPOINT_PLACEHOLDER =
	"Leave empty to use the controller's configured endpoint";
export const AGENTS_CONFIG_OTLP_PROTOCOL = "OTLP Protocol";
export const AGENTS_CONFIG_OTLP_PROTOCOL_HTTP = "HTTP/Protobuf";
export const AGENTS_CONFIG_OTLP_PROTOCOL_GRPC = "gRPC";
export const AGENTS_CONFIG_DISCOVERY = "Discovery";
export const AGENTS_CONFIG_AUTO_DISCOVER_LABEL = "Auto-discover LLM services";
export const AGENTS_CONFIG_AUTO_DISCOVER_DESCRIPTION = "Automatically scan for applications making LLM API calls";
export const AGENTS_CONFIG_CUSTOM_LLM_HOSTS = "Custom LLM Hosts";
export const AGENTS_CONFIG_CUSTOM_LLM_HOSTS_HELP = "Add custom hostnames for self-hosted LLM proxies (e.g. LiteLLM, Ollama, Azure per-deployment endpoints). Comma-separated. The controller will resolve these and monitor traffic to them.";
export const AGENTS_CONFIG_CUSTOM_LLM_HOSTS_PLACEHOLDER = "litellm.internal:4000, ollama.internal:11434, my-azure.openai.azure.com";
export const AGENTS_CONFIG_PAYLOAD_EXTRACTION = "Payload Extraction (LLM Providers)";
export const AGENTS_CONFIG_PAYLOAD_EXTRACTION_HELP = "Enable payload extraction to capture GenAI span attributes (prompts, completions, tokens) for each provider.";
export const AGENTS_CONFIG_OTLP_HEADERS = "OTLP Headers";
export const AGENTS_CONFIG_HEADER_NAME_PLACEHOLDER = "Header name";
export const AGENTS_CONFIG_HEADER_VALUE_PLACEHOLDER = "Value";
export const AGENTS_CONFIG_HEADER_REMOVE = "Remove";
export const AGENTS_CONFIG_ADD_HEADER = "+ Add Header";
export const AGENTS_PROVIDER_OPENAI = "OpenAI";
export const AGENTS_PROVIDER_ANTHROPIC = "Anthropic";
export const AGENTS_PROVIDER_GEMINI = "Gemini";
export const AGENTS_PROVIDER_COHERE = "Cohere";
export const AGENTS_PROVIDER_MISTRAL = "Mistral";
export const AGENTS_PROVIDER_GROQ = "Groq";
export const AGENTS_PROVIDER_DEEPSEEK = "DeepSeek";
export const AGENTS_PROVIDER_TOGETHER = "Together AI";
export const AGENTS_PROVIDER_FIREWORKS = "Fireworks AI";
export const AGENTS_PROVIDER_VERCEL_AI = "Vercel AI Gateway";
export const AGENTS_PROVIDER_VERTEX_AI = "Vertex AI";
export const AGENTS_PROVIDER_AZURE_INFERENCE = "Azure AI Inference";
export const AGENTS_PROVIDER_BEDROCK = "AWS Bedrock";
export const AGENTS_PROVIDER_QWEN = "Qwen";
export const AGENTS_PROVIDER_OLLAMA = "Ollama";
export const AGENTS_PROVIDER_CUSTOM = "Custom LLM Gateway";


// Getting Started - Openground
export const GET_STARTED_WITH_OPENGROUND = "Get Started with Openground";
export const GET_STARTED_WITH_OPENGROUND_DESCRIPTION = "Experiment and test different LLM configurations, prompts, and parameters. Compare outputs side-by-side to find the optimal setup for your use case.";
export const GET_STARTED_WITH_OPENGROUND_ACTION_BUTTON = "Create New Playground";
export const GET_STARTED_WITH_OPENGROUND_FEATURE_DETAILS = [
	{
		icon: "🔬",
		title: "Test Configurations",
		description: "Experiment with different LLM models, parameters, and settings to find the best configuration for your specific use case.",
	},
	{
		icon: "🔄",
		title: "Compare Results",
		description: "View outputs from different configurations side-by-side to make informed decisions about your LLM setup.",
	},
	{
		icon: "📝",
		title: "Prompt Testing",
		description: "Test and refine your prompts iteratively to achieve better results and more accurate AI responses.",
	},
	{
		icon: "⚡",
		title: "Quick Iteration",
		description: "Rapidly test multiple variations to optimize your LLM application before deploying to production.",
	}
];

// Getting Started - PromptHub
export const GET_STARTED_WITH_PROMPT_HUB = "Get Started with Prompt Hub";
export const GET_STARTED_WITH_PROMPT_HUB_DESCRIPTION = "Centralized prompt management system to version, deploy, and collaborate on prompts. Track prompt usage, manage variables, and easily retrieve prompts across your applications.";
export const GET_STARTED_WITH_PROMPT_HUB_ACTION_BUTTON = "Create New Prompt";
export const GET_STARTED_WITH_PROMPT_HUB_FEATURE_DETAILS = [
	{
		icon: "📝",
		title: "Version Control",
		description: "Track and manage different versions of your prompts with complete version history and rollback capabilities.",
	},
	{
		icon: "🔄",
		title: "Variable Support",
		description: "Create dynamic prompts with variable placeholders for flexible and reusable prompt templates.",
	},
	{
		icon: "👥",
		title: "Team Collaboration",
		description: "Collaborate with your team on prompt development and track who created and modified prompts.",
	},
	{
		icon: "📊",
		title: "Usage Tracking",
		description: "Monitor prompt downloads and usage across your applications to understand which prompts are most valuable.",
	}
];

// Getting Started - Vault
export const GET_STARTED_WITH_VAULT = "Get Started with Vault";
export const GET_STARTED_WITH_VAULT_DESCRIPTION = "Centralized secret management system to store, retrieve, and manage your secrets. Track secret usage, manage variables, and easily retrieve secrets across your applications.";
export const GET_STARTED_WITH_VAULT_ACTION_BUTTON = "Create New Secret";
export const GET_STARTED_WITH_VAULT_FEATURE_DETAILS = [
	{
		icon: "🔒",
		title: "Secure Storage",
		description: "Store LLM API keys and sensitive credentials securely with encryption and access controls.",
	},
	{
		icon: "🔑",
		title: "API Access",
		description: "Access your secrets through authenticated API endpoints for seamless integration with your applications.",
	},
	{
		icon: "👤",
		title: "User Tracking",
		description: "Track who created and updated each secret for complete accountability and transparency.",
	},
	{
		icon: "⏰",
		title: "Update History",
		description: "Monitor when secrets were last updated to ensure your credentials remain current and secure.",
	}
];

// Getting Started - Tracing
export const GET_STARTED_WITH_TRACING = "Get Started with Observability";
export const GET_STARTED_WITH_TRACING_DESCRIPTION = "OpenTelemetry-native auto-instrumentation to trace LLMs, agents, vector databases and GPUs with zero-code. Visualize application flow, identify performance bottlenecks, and track errors with detailed stack traces.";
export const GET_STARTED_WITH_TRACING_FEATURE_DETAILS = [
	{
		icon: "🔍",
		title: "Zero-Code Instrumentation",
		description: "Automatically trace LLMs, agents, frameworks, vector databases, and GPUs without modifying your existing code.",
	},
	{
		icon: "⚡",
		title: "Exception Tracking",
		description: "Track and debug application errors with detailed stack traces to rapidly identify and resolve issues.",
	},
	{
		icon: "🔄",
		title: "OpenTelemetry Compatible",
		description: "Full OpenTelemetry compatibility allows you to view traces from any OpenTelemetry-instrumented tool in your stack.",
	},
	{
		icon: "📊",
		title: "Performance Insights",
		description: "Visualize application flow and identify performance bottlenecks to optimize your GenAI and LLM applications.",
	}
];

// Generic texts
export const LOADING = "Loading";
export const CREATED_AT = "Created At";
export const VARIABLES = "Variables";
export const PROMPT = "Prompt";
export const PROMPT_PREVIEW = "Prompt Preview";
export const PROMPT_HUB = "Prompt Hub";
export const PROVIDERS = "Providers";
export const NO_DATA_FOUND = "No data found!";
export const CANNOT_CONNECT_TO_SERVER = "Cannot connect to server!";
export const PLEASE_SELECT = "Please select";
export const SELECT = "Select";
export const SAVING = "Saving...";
export const UPDATING = "Updating...";
export const CONFIGURATION_STORED_SECURELY = "Configuration stored securely";
export const BEST_EFFICIENCY = "Best Efficiency";
export const SOME_ERROR_OCCURRED = "Some error occurred while performing the operation";
export const RESET = "Reset";
export const ERROR = "Error";
export const SUCCESS = "Success";
export const HIDE = "Hide";
export const SHOW = "Show";
export const FASTEST = "Fastest";
export const AVERAGE = "Average";
export const SLOWEST = "Slowest";
export const CHEAPEST = "Cheapest";
export const COMPLETION = "Completion";
export const TOTAL = "Total";
export const COST = "Cost";
export const TOKENS = "Tokens";
export const CONFIGURE = "Configure";
export const CONFIGURED = "Configured";
export const SELECTED = "Selected";
export const CANCEL = "Cancel";
export const DELETE = "Delete";
export const LEAVE = "Leave";
export const CLOSE = "Close";
export const ACTIONS = "Actions";
export const JOIN = "Join";
export const CREATE = "Create";
export const CREATING = "Creating...";
export const SETTING_UP = "Setting up...";
export const SELECTING = "Selecting...";
export const EDIT_DETAILS = "Edit details";
export const LOG_OUT = "Log out";
export const EXPAND = "Expand";
export const DATABASES = "Databases";
export const DATABASE_CONFIG = "Database Config";
export const DB_CONFIG = "DB Config";
export const ADD_NEW_CONFIG = "Add New Config";
export const MANAGE_DB_CONFIG = "Manage DB Config";
export const PENDING_INVITATION = "Pending Invitation";

// Organisation
export const ORGANISATION = "Organisation";
export const ORGANISATIONS = "Organisations";
export const PROJECT = "Project";
export const PROJECTS = "Projects";
export const PROJECT_NAME = "Project Name";
export const PROJECT_NAME_PLACEHOLDER = "Production";
export const MANAGE_PROJECTS = "Manage Projects";
export const DEFAULT_PROJECT = "Default Project";
export const PROJECT_NAME_REQUIRED = "Project name is required";
export const PROJECT_NAME_LENGTH_ERROR = "Project name must be 120 characters or less";
export const PROJECT_NAME_LENGTH_RANGE_ERROR =
	"Project name must be between 1 and 120 characters";
export const CURRENT = "Current";
export const LOADING_PROJECT = "Loading project";
export const NO_PROJECT = "No project";
export const PROJECT_NOT_FOUND = "Project not found";
export const PROJECT_SWITCH_FAILED = "Failed to switch project";
export const DB_CONFIG_NOT_IN_CURRENT_PROJECT =
	"Database config doesn't exist in current project";
export const CURRENT_DB_CONFIG_SET_SUCCESS =
	"Current DB config set successfully!";
export const PROJECT_DB_CONFIG_DESCRIPTION =
	"Projects group database configs inside an organisation. Select a project before managing its database config.";
export const USE_PROJECT = "Use project";
export const ORGANISATION_NAME = "Organisation Name";
export const ORGANISATION_NAME_PLACEHOLDER = "My Company";
export const CREATE_ORGANISATION = "Create Organisation";
export const NEW_ORGANISATION = "New Organisation";
export const MANAGE_ORGANISATIONS = "Manage Organisations";
export const SWITCH_ORGANISATION = "Switch Organisation";
export const ORGANISATION_SETTINGS = "Organisation Settings";
export const ORGANISATION_SETTINGS_DESCRIPTION = "Manage your organisations and team members";
export const CURRENT_ORGANISATION = "Current Organisation";
export const UPDATE_ORGANISATION_DETAILS = "Update your organisation details";
export const YOUR_ORGANISATIONS = "Your Organisations";
export const YOUR_ORGANISATIONS_DESCRIPTION = "All organisations you are a member of";
export const YOUR_ORGANISATIONS_ONBOARDING_DESCRIPTION = "You're already a member of these organisations. Select one to get started.";
export const ORGANISATION_CREATED = "Organisation created successfully";
export const ORGANISATION_UPDATED = "Organisation updated successfully";
export const ORGANISATION_DELETED = "Organisation deleted successfully";
export const ORGANISATION_SWITCHED = "Switched organisation successfully";
export const ORGANISATION_SWITCH_FAILED = "Failed to switch organisation";
export const ORGANISATION_CREATE_FAILED = "Failed to create organisation";
export const ORGANISATION_UPDATE_FAILED = "Failed to update organisation";
export const ORGANISATION_DELETE_FAILED = "Failed to delete organisation";
export const ORGANISATION_CREATE_DESCRIPTION = "Create a new organisation to manage your databases and team members.";
export const ORGANISATION_DELETE_DESCRIPTION = "Remove all members before deleting this organisation.";

// Organisation Members
export const MEMBERS = "Members";
export const MEMBER = "Member";
export const OWNER = "Owner";
export const ADMIN = "Admin";
export const ROLE = "Role";
export const CHANGE_ROLE = "Change Role";
export const MEMBER_ROLE_UPDATED = "Member role updated successfully";
export const MEMBER_ROLE_UPDATE_FAILED = "Failed to update member role";
export const INVITE_MEMBERS = "Invite Members";
export const INVITE_MEMBERS_DESCRIPTION = "Invite new members to your organisation";
export const INVITE_NEW_MEMBER = "Invite New Member";
export const INVITE = "Invite";
export const INVITING = "Inviting...";
export const INVITATIONS_SENT = "Invitations sent successfully";
export const INVITATION_FAILED = "Failed to send invitations";
export const INVITATIONS_PARTIAL_SUCCESS = "Sent {success} invitation(s), {fail} failed";
export const REMOVE_MEMBER = "Remove Member";
export const REMOVE_MEMBER_CONFIRMATION = "Are you sure you want to remove this member from the organisation?";
export const MEMBER_REMOVED = "Member removed successfully";
export const LEAVE_ORGANISATION = "Leave Organisation";
export const LEAVE_ORGANISATION_CONFIRMATION = "Are you sure you want to leave this organisation?";
export const DELETE_ORGANISATION = "Delete Organisation";
export const DELETE_ORGANISATION_CONFIRMATION = "Are you sure you want to delete this organisation? This action cannot be undone.";
export const DANGER_ZONE = "Danger Zone";
export const DANGER_ZONE_DESCRIPTION = "Irreversible actions for this organisation";
export const GENERAL = "General";
export const DETAILS = "Details";
export const PENDING = "Pending";
export const NAME = "Name";
export const EMAIL = "Email";
export const SAVE = "Save";
export const ACTIVE = "Active";
export const INACTIVE = "Inactive";
export const STATUS = "Status";

// Organisation Errors
export const NOT_ORGANISATION_MEMBER = "You are not a member of this organisation";
export const ORGANISATION_NOT_FOUND = "Organisation not found";
export const ORGANISATION_NOTHING_TO_UPDATE = "Nothing to update";
export const ORGANISATION_ONLY_CREATOR_CAN_DELETE = "Only the creator can delete the organisation";
export const ORGANISATION_CANNOT_DELETE_WITH_MEMBERS = "Cannot delete organisation with other members";
export const USER_ALREADY_ORGANISATION_MEMBER = "User is already a member of this organisation";
export const CREATE_ORGANISATION_PROJECT = "Create project";
export const ORGANISATION_PROJECT_CREATED = "Project created";
export const ORGANISATION_PROJECT_CREATE_FAILED =
	"Unable to create project";
export const NO_ORGANISATION_PROJECTS = "No projects yet. Create one above.";
export const SLUG = "Slug";
export const USER_ALREADY_INVITED = "User has already been invited to this organisation";
export const INVITATION_NOT_FOR_YOU = "This invitation is not for you";
export const INVITATION_NOT_FOUND = "Invitation not found";
export const ONLY_CREATOR_CAN_REMOVE_MEMBERS = "Only the organisation creator can remove other members";
export const ONLY_ADMIN_CAN_REMOVE_MEMBERS = "Only organisation admins or owner can remove members";
export const INSUFFICIENT_PERMISSIONS = "You don't have permission to perform this action";
export const ONLY_ADMIN_CAN_INVITE = "Only organisation admins or owner can invite new members";
export const ONLY_ADMIN_CAN_CANCEL_INVITATION = "Only organisation admins or owner can cancel invitations";
export const ONLY_ADMIN_CAN_UPDATE_ORGANISATION = "Only organisation admins or owner can update organisation settings";
export const CANNOT_REMOVE_ADMIN_OR_OWNER = "Only the owner can remove admins or other owners";
export const CANNOT_LEAVE_WITH_MEMBERS = "Cannot leave organisation while other members exist. Transfer ownership or remove other members first.";
export const CREATOR_CANNOT_LEAVE_ALONE = "Cannot leave organisation as the sole member. Delete the organisation instead.";
export const ONLY_ADMIN_OR_OWNER_CAN_UPDATE_ROLES = "Only organisation admins or owner can update member roles";
export const CANNOT_CHANGE_OWNER_ROLE = "Cannot change the owner's role";
export const CANNOT_CHANGE_ADMIN_ROLE = "Only the owner can change admin roles";
export const INVALID_MEMBER_ROLE = "Invalid role. Must be 'member' or 'admin'";

// Organisation Invitations
export const PENDING_INVITATIONS = "Pending Invitations";
export const PENDING_INVITES = "Pending Invites";
export const PENDING_INVITES_DESCRIPTION = "Invitations sent but not yet accepted";
export const PENDING_INVITATIONS_DESCRIPTION = "You have been invited to join the following organisations";
export const PENDING_INVITATIONS_ONBOARDING_DESCRIPTION = "You've been invited to join the following organisations";
export const INVITATION_ACCEPTED = "Joined organisation successfully";
export const INVITATION_DECLINED = "Invitation declined";
export const INVITATION_CANCELLED = "Invitation cancelled";
export const INVITATION_ACCEPT_FAILED = "Failed to accept invitation";
export const INVITATION_DECLINE_FAILED = "Failed to decline invitation";
export const INVITATION_CANCEL_FAILED = "Failed to cancel invitation";
export const INVITED = "Invited";

// Rule Engine
export const RULE_CREATED = "Rule created successfully!";
export const RULE_UPDATED = "Rule updated successfully!";
export const RULE_DELETED = "Rule deleted successfully!";
export const RULE_NOT_FOUND = "Rule not found!";
export const RULE_NOT_CREATED = "Rule cannot be created!";
export const RULE_NOT_UPDATED = "Rule cannot be updated!";
export const RULE_NOT_DELETED = "Error deleting rule!";
export const RULE_NAME_REQUIRED = "Rule name is required!";
export const RULE_CONDITION_GROUP_ADDED = "Condition group added successfully!";
export const RULE_CONDITION_GROUP_NOT_ADDED = "Condition group cannot be added!";
export const RULE_ENTITY_ASSOCIATED = "Entity associated with rule successfully!";
export const RULE_ENTITY_NOT_ASSOCIATED = "Entity cannot be associated with rule!";
export const RULE_ENTITY_DELETED = "Rule entity association deleted successfully!";
export const RULE_ENTITY_NOT_DELETED = "Error deleting rule entity association!";
export const RULE_CONDITION_FIELD_REQUIRED = "Condition field is required!";
export const RULE_CONDITION_OPERATOR_REQUIRED = "Condition operator is required!";
export const RULE_CONDITION_VALUE_REQUIRED = "Condition value is required!";
export const RULE_ENTITY_TYPE_INVALID = "Invalid entity type!";

// Rule Engine – UI labels & feedback
export const RULE_LOAD_FAILED = "Failed to load rule";
export const RULE_UPDATE_FAILED = "Failed to update rule";
export const RULE_CONDITIONS_SAVED = "Conditions saved!";
export const RULE_CONDITIONS_SAVE_FAILED = "Failed to save conditions";
export const RULE_CREATING = "Creating rule...";
export const RULE_CREATE_FAILED = "Creation of rule failed!";
export const RULE_ENTITY_ID_REQUIRED = "Entity ID is required";
export const RULE_ENTITY_ALREADY_ASSOCIATED = "This entity is already associated with the rule";
export const RULE_ENTITY_ASSOCIATE_FAILED = "Failed to associate entity";
export const RULE_ENTITY_REMOVE_FAILED = "Failed to remove entity";
export const RULE_ENTITY_REMOVED = "Entity removed";
export const RULE_ENGINE_BREADCRUMB = "Rule Engine";
export const RULE_CONDITION_GROUPS_TITLE = "Condition Groups";
export const RULE_SAVE_CONDITIONS = "Save Conditions";
export const RULE_CREATE_BUTTON = "Create Rule";
export const RULE_CREATED_BY = "Created by";
export const RULE_INACTIVE = "Inactive";

// Rule Engine – info section
export const RULE_DESCRIPTION_LABEL = "Description";
export const RULE_DESCRIPTION_PLACEHOLDER = "What does this rule do?";
export const RULE_DESCRIPTION_INFO = "Optional. Explain the purpose and intent of this rule.";
export const RULE_GROUP_OPERATOR_LABEL = "Group Operator";
export const RULE_GROUP_OPERATOR_INFO = "AND requires all condition groups to match. OR requires at least one group to match.";
export const RULE_GROUP_OPERATOR_AND = "AND – all groups match";
export const RULE_GROUP_OPERATOR_OR = "OR – any group matches";
export const RULE_STATUS_INFO = "Only ACTIVE rules are evaluated during rule engine execution.";

// Rule Engine – create form
export const RULE_CREATE_NEW = "Create a new rule";
export const RULE_CREATE_AND_LINK_TO = "Create rule and link to";
export const RULE_CREATE_SUBMIT = "Create rule";
export const RULE_NAME_PLACEHOLDER = "e.g. High cost alert";
export const RULE_NAME_INFO = "A unique, descriptive name to identify this rule.";

// Rule Engine – preview section
export const RULE_PREVIEW_TITLE = "Rule Preview";
export const RULE_PREVIEW_TOOLTIP = "Shows the top 5 matched traces from the last 100 records — just to verify the rule is working correctly.";
export const RULE_PREVIEW_RUN = "Run Preview";
export const RULE_PREVIEW_RUNNING = "Running\u2026";
export const RULE_PREVIEW_EMPTY = "Click \u201cRun Preview\u201d to test your saved rule conditions against recent traces.";
export const RULE_PREVIEW_NO_MATCHES = "No matching traces found in the last 100 records.";
export const RULE_PREVIEW_FAILED = "Preview failed";

// Rule Engine – entities card
export const RULE_ASSOCIATED_ENTITIES = "Associated Entities";
export const RULE_NO_ENTITIES = "No entities associated yet.";
export const RULE_ASSOCIATE_NEW_ENTITY = "Associate New Entity";
export const RULE_ASSOCIATE = "Associate";
export const RULE_REMOVE_ENTITY_TITLE = "Remove entity association?";
export const RULE_REMOVE_ENTITY_SUBTITLE = "This will remove the link between the rule and this entity.";

// Rule Engine – condition builder
export const RULE_NO_CONDITION_GROUPS = "No condition groups yet.";
export const RULE_ADD_FIRST_GROUP = "Add First Group";
export const RULE_ADD_GROUP = "Add Group";
export const RULE_ADD_CONDITION = "Add Condition";
export const RULE_WITHIN_GROUP = "within group";
export const RULE_FIELD_VALUES_INFO = "Top 100 values from traces. Press Enter to add a custom value.";
export const RULE_FIELD_VALUES_LOADING = "Loading values\u2026";
export const RULE_FIELD_VALUES_SEARCH = "Search or type value\u2026";
export const RULE_FIELD_VALUES_NO_MATCH = "No matching values";
export const RULE_FIELD_PLACEHOLDER = "Field";
export const RULE_OPERATOR_PLACEHOLDER = "Op";
export const RULE_VALUE_PLACEHOLDER = "Value";

// Rule Engine – condition field labels & descriptions
export const RULE_FIELD_SERVICE_NAME = "Service Name";
export const RULE_FIELD_SERVICE_NAME_DESC = "The service name reported by the SDK.";
export const RULE_FIELD_SPAN_NAME = "Span Name";
export const RULE_FIELD_SPAN_NAME_DESC = "The operation or span name.";
export const RULE_FIELD_SPAN_KIND = "Span Kind";
export const RULE_FIELD_SPAN_KIND_DESC = "CLIENT, SERVER, INTERNAL, etc.";
export const RULE_FIELD_DURATION = "Duration (ms)";
export const RULE_FIELD_DURATION_DESC = "Span duration in milliseconds.";
export const RULE_FIELD_STATUS_CODE = "Status Code";
export const RULE_FIELD_STATUS_CODE_DESC = "Span status: OK, ERROR, or UNSET.";
export const RULE_FIELD_DEPLOYMENT_ENV = "Deployment Env";
export const RULE_FIELD_DEPLOYMENT_ENV_DESC = "Deployment environment (e.g. production, staging).";
export const RULE_FIELD_SERVICE_NAME_OTEL = "Service Name (OTel)";
export const RULE_FIELD_SERVICE_NAME_OTEL_DESC = "OTel resource attribute: service.name.";
export const RULE_FIELD_GEN_AI_SYSTEM = "Gen AI System";
export const RULE_FIELD_GEN_AI_SYSTEM_DESC = "AI provider identifier (e.g. openai, anthropic).";
export const RULE_FIELD_MODEL = "Model";
export const RULE_FIELD_MODEL_DESC = "LLM model name (e.g. gpt-4o, claude-3-5-sonnet).";
export const RULE_FIELD_INPUT_TOKENS = "Input Tokens";
export const RULE_FIELD_INPUT_TOKENS_DESC = "Number of prompt/input tokens used.";
export const RULE_FIELD_OUTPUT_TOKENS = "Output Tokens";
export const RULE_FIELD_OUTPUT_TOKENS_DESC = "Number of completion/output tokens generated.";
export const RULE_FIELD_TOTAL_COST = "Total Cost ($)";
export const RULE_FIELD_TOTAL_COST_DESC = "Total cost of the request in USD.";
export const RULE_FIELD_TEMPERATURE = "Temperature";
export const RULE_FIELD_TEMPERATURE_DESC = "Sampling temperature used for the request (0\u20132).";

// Context
export const CONTEXT_CREATED = "Context created successfully!";
export const CONTEXT_UPDATED = "Context updated successfully!";
export const CONTEXT_DELETED = "Context deleted successfully!";
export const CONTEXT_NOT_FOUND = "Context not found!";
export const CONTEXT_NOT_CREATED = "Context cannot be created!";
export const CONTEXT_NOT_UPDATED = "Context cannot be updated!";
export const CONTEXT_NOT_DELETED = "Error deleting context!";
export const CONTEXT_NAME_REQUIRED = "Context name is required!";
export const CONTEXT_CONTENT_REQUIRED = "Context content is required!";

// Onboarding
export const ONBOARDING_WELCOME = "Welcome to OpenLIT";
export const ONBOARDING_SUBTITLE = "Let's get you set up with an organisation";
export const ONBOARDING_CREATE_DESCRIPTION = "Create a new organisation to get started";
export const ONBOARDING_SKIP = "Skip for now (create a Personal organisation)";
export const PERSONAL_ORGANISATION = "Personal";

// Auth
export const AUTH_WELCOME = "Welcome to OpenLIT";
export const AUTH_SUBTITLE = "Open Source Platform for AI Engineering";
export const AUTH_SIGNING_IN = "Signing in...";
export const AUTH_CONTINUE_WITH_GOOGLE = "Continue with Google";
export const AUTH_CONTINUE_WITH_GITHUB = "Continue with Github";
export const AUTH_OR = "Or";
export const AUTH_EMAIL = "Email";
export const AUTH_EMAIL_PLACEHOLDER = "user@openlit.io";
export const AUTH_PASSWORD = "Password";
export const AUTH_PASSWORD_PLACEHOLDER = "********";
export const AUTH_SIGN_IN = "Sign in";
export const AUTH_SIGN_UP = "Sign Up";
export const AUTH_NO_ACCOUNT = "Don't have an account?";
export const AUTH_HAVE_ACCOUNT = "Already have an account?";
export const AUTH_GITHUB = "Github";
export const AUTH_DOCUMENTATION = "Documentation";
export const AUTH_FOOTER = "Open Source AI Observability Platform";
export const AUTH_ERROR_ACCESS_DENIED = "Access denied for this account.";
export const AUTH_ERROR_TRY_DIFFERENT = "Try signing with a different account.";
export const AUTH_ERROR_CONFIRM_IDENTITY = "To confirm your identity, sign in with the same account you used originally.";
export const AUTH_ERROR_CHECK_EMAIL = "Check your email address.";
export const AUTH_ERROR_CREDENTIALS = "Sign in failed. Check the details you provided are correct.";
export const AUTH_ERROR_CONFIGURATION = "There is a problem with the server configuration.";
export const AUTH_ERROR_DEFAULT = "Unable to sign in.";
export const AUTH_ERROR_GOOGLE = "Failed to sign in with Google";
export const AUTH_ERROR_GITHUB = "Failed to sign in with Github";

// Auth feature highlights
export const AUTH_FEATURE_TRACING = "End-to-End Tracing";
export const AUTH_FEATURE_TRACING_DESC = "Full request tracing across LLM providers";
export const AUTH_FEATURE_ANALYTICS = "Cost & Token Analytics";
export const AUTH_FEATURE_ANALYTICS_DESC = "Real-time cost tracking and token usage";
export const AUTH_FEATURE_EVALS = "11 Evaluation Types";
export const AUTH_FEATURE_EVALS_DESC = "Hallucination, bias, toxicity, safety & more";
export const AUTH_FEATURE_JUDGE = "LLM-as-a-Judge";
export const AUTH_FEATURE_JUDGE_DESC = "Automated quality scoring with any LLM";
export const AUTH_FEATURE_OPENGROUND = "OpenGround";
export const AUTH_FEATURE_OPENGROUND_DESC = "Compare LLMs side-by-side on cost & quality";
export const AUTH_FEATURE_PROMPT_HUB = "Prompt Hub";
export const AUTH_FEATURE_PROMPT_HUB_DESC = "Version, manage, and deploy prompts";
export const AUTH_FEATURE_RULE_ENGINE = "Rule Engine";
export const AUTH_FEATURE_RULE_ENGINE_DESC = "Conditional context and prompt retrieval";
export const AUTH_FEATURE_VAULT = "Vault";
export const AUTH_FEATURE_VAULT_DESC = "Secure secrets and API key management";
export const AUTH_FEATURE_AGENTS = "Agents";
export const AUTH_FEATURE_AGENTS_DESC = "Manage and operate AI agents from a single hub";
export const AUTH_FEATURE_OTEL = "OpenTelemetry Native";
export const AUTH_FEATURE_OTEL_DESC = "Built on open standards, no vendor lock-in";

// Context UI
export const CONTEXT_TITLE = "Context";
export const CONTEXT_CREATE = "Create Context";
export const CONTEXT_BACK_TO_LIST = "Back to Contexts";
export const CONTEXT_SAVE = "Save Context";
export const CONTEXT_NAME = "Name";
export const CONTEXT_NAME_PLACEHOLDER = "My Context";
export const CONTEXT_DESCRIPTION = "Description";
export const CONTEXT_DESCRIPTION_PLACEHOLDER = "Optional description";
export const CONTEXT_DESCRIPTION_OPTIONAL = "(optional)";
export const CONTEXT_CONTENT = "Content";
export const CONTEXT_CONTENT_HINT = "The context content (required)";
export const CONTEXT_CONTENT_PLACEHOLDER = "Enter context content...";
export const CONTEXT_CONTENT_MARKDOWN_HINT = "Write your context content here. Markdown is supported.";
export const CONTEXT_TAGS = "Tags";
export const CONTEXT_TAGS_PLACEHOLDER = "Add tags";
export const CONTEXT_TAGS_ENTER_PLACEHOLDER = "Add a tag, press Enter";
export const CONTEXT_STATUS = "Status";
export const CONTEXT_STATUS_PLACEHOLDER = "Select status";
export const CONTEXT_STATUS_ACTIVE = "Active";
export const CONTEXT_STATUS_INACTIVE = "Inactive";
export const CONTEXT_UPDATE = "Update context";
export const CONTEXT_CREATE_NEW = "Create a new context";
export const CONTEXT_UPDATING = "Updating context...";
export const CONTEXT_CREATING = "Creating context...";
export const CONTEXT_UPDATED_SUCCESS = "Updated context successfully!";
export const CONTEXT_CREATED_SUCCESS = "Created context successfully!";
export const CONTEXT_UPDATE_FAILED = "Update of context failed!";
export const CONTEXT_CREATE_FAILED = "Creation of context failed!";
export const CONTEXT_META_PROPERTIES = "Meta Properties";
export const CONTEXT_ADD_PROPERTY = "Add property";
export const CONTEXT_NONE = "None";
export const CONTEXT_WRITE = "Write";
export const CONTEXT_PREVIEW = "Preview";
export const CONTEXT_NOTHING_TO_PREVIEW = "Nothing to preview yet.";
export const CONTEXT_NO_CONTENT = "No content yet. Click Edit to add content.";
export const CONTEXT_RULES = "Rules";
export const CONTEXT_NEW_RULE = "New Rule";
export const CONTEXT_NO_RULES = "No rules linked yet.";
export const CONTEXT_LINK_RULE = "Link existing rule";
export const CONTEXT_SELECT_RULE = "Select a rule...";
export const CONTEXT_ALL_RULES_LINKED = "All rules already linked";
export const CONTEXT_ASSOCIATE = "Associate";
export const CONTEXT_DELETE_CONFIRM = "Are you sure you want to delete this context?";
export const CONTEXT_DELETE_WARNING = "Deleting context might break applications using it. Please confirm before deleting it.";
export const CONTEXT_CREATED_BY = "Created By";

// Prompt Hub UI
export const PROMPT_HUB_CREATE = "Create new";
export const PROMPT_HUB_CREATE_PROMPT = "Create Prompt";
export const PROMPT_HUB_BACK = "Back to Prompt Hub";
export const PROMPT_HUB_SAVE = "Save Prompt";
export const PROMPT_HUB_NAME_HINT = "(lowercase letters and _ only)";
export const PROMPT_HUB_NAME_PLACEHOLDER = "my_prompt";
export const PROMPT_HUB_NAME_REQUIRED = "Prompt name is required";
export const PROMPT_HUB_CONTENT_REQUIRED = "Prompt content is required";
export const PROMPT_HUB_VARIABLE_HINT = "Use {{variableName}} for dynamic variables";
export const PROMPT_HUB_CONTENT_PLACEHOLDER = "Write your prompt here. Use {{variable}} for dynamic content.";
export const PROMPT_HUB_NOTHING_TO_PREVIEW = "Nothing to preview yet.";
export const PROMPT_HUB_NO_CONTENT = "No prompt content.";
export const PROMPT_HUB_VERSION = "Version";
export const PROMPT_HUB_LATEST_VERSION = "Latest Version";
export const PROMPT_HUB_DRAFT = "Draft";
export const PROMPT_HUB_NO_VERSION = "No version assigned";
export const PROMPT_HUB_DRAFT_DESCRIPTION = "Save as a draft — not yet published";
export const PROMPT_HUB_MAJOR = "Major";
export const PROMPT_HUB_MAJOR_DESCRIPTION = "Significant changes, not backwards compatible";
export const PROMPT_HUB_MINOR = "Minor";
export const PROMPT_HUB_MINOR_DESCRIPTION = "New features, backwards compatible";
export const PROMPT_HUB_PATCH = "Patch";
export const PROMPT_HUB_PATCH_DESCRIPTION = "Bug fixes and minor updates";
export const PROMPT_HUB_PUBLISH = "Publish Version";
export const PROMPT_HUB_CREATE_VERSION = "Create New Version";
export const PROMPT_HUB_PUBLISHED_ON = "Published on";
export const PROMPT_HUB_VERSIONS = "Versions";
export const PROMPT_HUB_LATEST = "latest";
export const PROMPT_HUB_DOWNLOADS = "Downloads";
export const PROMPT_HUB_LAST_RELEASED = "Last Released On";
export const PROMPT_HUB_LINKED_RULES = "Linked Rules";
export const PROMPT_HUB_DELETE_CONFIRM = "Are you sure you want to delete this prompt?";
export const PROMPT_HUB_DELETE_WARNING = "Deleting prompts might result in breaking application if they are getting used. Please confirm before deleting it.";
export const PROMPT_HUB_CREATING = "Creating prompt...";
export const PROMPT_HUB_CREATED_SUCCESS = "Prompt created successfully!";
export const PROMPT_HUB_CREATE_FAILED_TOAST = "Failed to create prompt";
export const PROMPT_HUB_SAVING = "Saving...";
export const PROMPT_HUB_SAVED_SUCCESS = "Prompt saved!";
export const PROMPT_HUB_SAVE_FAILED = "Failed to save prompt";
export const PROMPT_HUB_EDITING_DRAFT = "Editing draft — publish when ready";
export const PROMPT_HUB_CREATING_VERSION = "Creating a new version from the latest published";
export const PROMPT_HUB_BACK_TO = "Back to";
export const PROMPT_HUB_LEARN_MORE = "Learn more";
export const PROMPT_HUB_NO_PROMPT_EXISTS = "No such prompt exists!";
export const PROMPT_HUB_NO_VERSION_EXISTS = "No such version of the prompt";
export const PROMPT_HUB_EXISTS = "exists!";
export const PROMPT_HUB_RULE_NAME = "Rule name";
export const PROMPT_HUB_RULE_DESCRIPTION = "Rule description";
export const PROMPT_HUB_NO_RULES = "No rules linked yet.";
export const PROMPT_HUB_SELECT_RULE = "Select a rule...";
export const PROMPT_HUB_ALL_RULES_LINKED = "All rules already linked";
export const PROMPT_HUB_NO_VERSION_CHANGE = "No version change";
export const PROMPT_HUB_KEEP_DRAFT = "Keep as draft — not published";
export const PROMPT_OTTER_TOOLTIP = "Improve this prompt with Otter";
export const PROMPT_OTTER_TITLE = "Improve prompt with Otter";
export const PROMPT_OTTER_DESCRIPTION = "Choose the dimensions Otter should review, then accept or decline patch suggestions directly into the editor.";
export const PROMPT_OTTER_DIMENSIONS = "Improvement dimensions";
export const PROMPT_OTTER_DIMENSIONS_HELP = "Edit, remove, or add review points before running the analysis.";
export const PROMPT_OTTER_CRITERIA_CONCISE = "Be concise and remove redundant wording.";
export const PROMPT_OTTER_CRITERIA_STRUCTURE = "Make the instruction structure easier to follow.";
export const PROMPT_OTTER_CRITERIA_VARIABLES = "Preserve variables like {{variableName}} exactly.";
export const PROMPT_OTTER_CRITERIA_OUTPUT = "Clarify output format, constraints, and success criteria.";
export const PROMPT_OTTER_CRITERIA_AMBIGUITY = "Reduce ambiguity without changing the prompt intent.";
export const PROMPT_OTTER_DEFAULT_DIMENSION = "Prompt quality";
export const PROMPT_OTTER_CONFIG_NOT_FOUND = "Chat configuration not found. Configure Otter first.";
export const PROMPT_OTTER_SUMMARY_PREFIX = "Prompt improvement generated";
export const PROMPT_OTTER_SUGGESTION = "suggestion";
export const PROMPT_OTTER_SUGGESTIONS = "suggestions";
export const PROMPT_OTTER_ADD_DIMENSION = "Add another review point";
export const PROMPT_OTTER_RUN = "Run prompt analysis";
export const PROMPT_OTTER_RUN_SHORT = "Improve";
export const PROMPT_OTTER_ANALYZING = "Analyzing prompt...";
export const PROMPT_OTTER_CONTINUATION_PLACEHOLDER = "Ask Otter to also focus on tone, safety, examples, formatting...";
export const PROMPT_OTTER_PENDING = "pending";
export const PROMPT_OTTER_EMPTY_PROMPT = "Add prompt content before running Otter.";
export const PROMPT_OTTER_ANALYSIS_FAILED = "Prompt analysis failed";
export const PROMPT_OTTER_NO_SUGGESTIONS = "Otter did not find any precise prompt changes.";
export const PROMPT_OTTER_ORIGINAL_NOT_FOUND = "This suggestion no longer matches the current prompt.";
export const PROMPT_OTTER_EMPTY_STATE = "No prompt suggestions yet";
export const PROMPT_OTTER_EMPTY_STATE_HELP = "Run Otter to compare concise, structured improvements against the current prompt.";
export const PROMPT_OTTER_SHOW_CHANGE = "Show change";
export const PROMPT_OTTER_REMOVE = "Remove";
export const PROMPT_OTTER_ADD = "Add";

// Rule Engine UI
export const RULE_ENGINE_CREATE = "Create rule";
export const RULE_ENGINE_NAME = "Name";
export const RULE_ENGINE_DESCRIPTION = "Description";
export const RULE_ENGINE_GROUP_OPERATOR = "Group Operator";
export const RULE_ENGINE_STATUS = "Status";
export const RULE_ENGINE_CREATED_BY = "Created By";
export const RULE_ENGINE_DELETE_CONFIRM = "Are you sure you want to delete this rule?";
export const RULE_ENGINE_DELETE_WARNING = "Deleting this rule will also remove all its conditions and entity associations.";

// Common UI
export const CREATED_BY = "Created By";
export const DESCRIPTION = "Description";
export const EDIT = "Edit";
export const WRITE = "Write";
export const PREVIEW = "Preview";
export const BACK = "Back";
export const ACCEPT = "Accept";
export const DECLINE = "Decline";
export const KEY = "Key";
export const VALUE = "Value";
export const AND = "AND";
export const OR = "OR";
export const TAGS = "Tags";
export const META_PROPERTIES = "Meta Properties";
export const ADD_PROPERTY = "Add property";
export const NEW_RULE = "New Rule";
export const LINK_EXISTING_RULE = "Link existing rule";
export const ASSOCIATE = "Associate";
export const RULES = "Rules";
export const NO_DASH = "-";

// Chat
export const CHAT_TITLE = "Otter";
export const CHAT_DESCRIPTION = "Ask questions about your observability data using natural language";
export const CHAT_SETTINGS_TITLE = "Chat Settings";
export const CHAT_SETTINGS_DESCRIPTION = "Configure the AI provider for the chat feature";
export const CHAT_NEW_CHAT = "New Chat";
export const CHAT_SEARCH_CONVERSATIONS = "Search conversations...";
export const CHAT_NO_MATCHING_CONVERSATIONS = "No matching conversations";
export const CHAT_NO_CONVERSATIONS_YET = "No conversations yet";
export const CHAT_NEW_CONVERSATION = "New conversation";
export const CHAT_ASK_QUESTION = "Ask a question about your data...";
export const CHAT_ENTER_TO_SEND = "Press Enter to send, Shift+Enter for new line";
export const CHAT_EMPTY_TITLE = "Your AI-Powered Observability Copilot";
export const CHAT_EMPTY_DESCRIPTION = "Query your telemetry data, create dashboards, manage rules, prompts, and more — all through natural language. What would you like to explore?";
export const CHAT_CONFIGURE_PROVIDER = "Configure your AI provider in";
export const CHAT_SETTINGS_LINK = "Chat Settings";
export const CHAT_TO_GET_STARTED = "to get started.";
export const CHAT_EXAMPLE_Q1 = "Analyze the slowest traces from the last 24 hours and explain what is causing latency";
export const CHAT_EXAMPLE_Q2 = "Show token usage and cost by model for this week, then highlight the biggest spend drivers";
export const CHAT_EXAMPLE_Q3 = "Find recent errors for my busiest service and summarize the related traces and logs";
export const CHAT_EXAMPLE_Q4 = "Create a dashboard for request volume, error rate, latency, token usage, and cost";
export const CHAT_EXAMPLE_Q5 = "Run improvement analysis on traces with high cost and suggest where to reduce tokens";
export const CHAT_EXAMPLE_Q6 = "Create a rule that alerts when a trace fails or request duration exceeds 5 seconds";
export const CHAT_SQL_LABEL = "SQL Query";
export const CHAT_COPY = "Copy";
export const CHAT_COPIED = "Copied";
export const CHAT_EXECUTE = "Execute";
export const CHAT_RUNNING = "Running...";
export const CHAT_QUERY_EXECUTION_FAILED = "Query execution failed";
export const CHAT_NO_DATA_RETURNED = "No data returned";
export const CHAT_SAVE_AS_WIDGET = "Save as Widget";
export const CHAT_SAVE_WIDGET_TITLE = "Save as Widget";
export const CHAT_WIDGET_TITLE_LABEL = "Title";
export const CHAT_WIDGET_TITLE_PLACEHOLDER = "Widget title";
export const CHAT_WIDGET_TYPE_LABEL = "Widget Type";
export const CHAT_WIDGET_DASHBOARD_LABEL = "Add to Dashboard (optional)";
export const CHAT_WIDGET_DASHBOARD_PLACEHOLDER = "Select a dashboard";
export const CHAT_WIDGET_SAVED = "Widget saved successfully";
export const CHAT_WIDGET_SAVE_FAILED = "Failed to save widget";
export const CHAT_WIDGET_ENTER_TITLE = "Please enter a title";
export const CHAT_SETTINGS_PROVIDER_LABEL = "AI Provider";
export const CHAT_SETTINGS_PROVIDER_PLACEHOLDER = "Select a provider";
export const CHAT_SETTINGS_MODEL_LABEL = "Model";
export const CHAT_SETTINGS_MODEL_PLACEHOLDER = "Select a model";
export const CHAT_SETTINGS_MODEL_HINT = "Models are managed in";
export const CHAT_SETTINGS_MANAGE_MODELS = "Manage Models";
export const CHAT_SETTINGS_MODEL_HINT_SUFFIX = ". Custom models you add there will appear here.";
export const CHAT_SETTINGS_API_KEY_LABEL = "API Key (from Vault)";
export const CHAT_SETTINGS_API_KEY_PLACEHOLDER = "Select a vault secret";
export const CHAT_SETTINGS_API_KEY_HINT_PREFIX = "Store your API key in the";
export const CHAT_SETTINGS_API_KEY_HINT_SUFFIX = "first, then select it here";
export const CHAT_SETTINGS_SAVE = "Save Configuration";
export const CHAT_SETTINGS_SAVED = "Chat configuration saved";
export const CHAT_SETTINGS_SAVE_FAILED = "Failed to save configuration";
export const CHAT_SETTINGS_LOAD_FAILED = "Failed to load configuration";
export const CHAT_SETTINGS_FILL_ALL = "Please fill in all fields";
export const CHAT_SETTINGS_SELECT_PROVIDER_FIRST = "Select a provider first";
export const CHAT_SETTINGS_CONFIG_TOOLTIP_TITLE = "Chat Configuration";
export const CHAT_SETTINGS_CONFIG_PROVIDER = "Provider";
export const CHAT_SETTINGS_CONFIG_MODEL = "Model";
export const CHAT_SETTINGS_CONFIG_API_KEY = "API Key";
export const CHAT_SETTINGS_CONFIG_API_KEY_CONFIGURED = "configured";
export const CHAT_SETTINGS_CONFIG_PRICING = "Pricing (per message)";
export const CHAT_SETTINGS_CONFIG_INPUT = "Input";
export const CHAT_SETTINGS_CONFIG_OUTPUT = "Output";
export const CHAT_SETTINGS_CONFIG_CONTEXT = "Context";
export const CHAT_SETTINGS_CONFIG_COST_CALCULATION = "Cost calculation";
export const CHAT_SETTINGS_CONFIG_COST_FORMULA =
	"cost = (input_tokens / 1M) x input_price + (output_tokens / 1M) x output_price";
export const CHAT_SETTINGS_OR = "or";
export const CHAT_FAILED_TO_CREATE_CONVERSATION = "Failed to create conversation";
export const CHAT_FAILED_TO_DELETE_CONVERSATION = "Failed to delete conversation";
export const CHAT_ROWS = "rows";
export const CHAT_TOKENS = "tokens";
export const CHAT_ERROR_PREFIX = "Error:";
export const CHAT_SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";
export const CHAT_FAILED_TO_GET_RESPONSE = "Failed to get response";
export const CHAT_NO_RESPONSE_STREAM = "No response stream";
export const CHAT_OTTER_USAGE = "Otter usage";
export const CHAT_OTTER_USAGE_DESCRIPTION =
	"Token and cost attribution by feature, provider, model, and date.";
export const CHAT_OTTER_USAGE_LOAD_FAILED = "Failed to load Otter usage";
export const CHAT_OTTER_USAGE_EMPTY_TITLE = "No Otter usage recorded yet";
export const CHAT_OTTER_USAGE_EMPTY_DESCRIPTION =
	"Run a chat or AI analysis to see provider, model, token, and cost attribution here.";
export const CHAT_OTTER_USAGE_TOTAL_TOKENS = "Total tokens";
export const CHAT_OTTER_USAGE_TOTAL_COST = "Total cost";
export const CHAT_OTTER_USAGE_PROMPT_COMPLETION = "Prompt / completion";
export const CHAT_OTTER_USAGE_ACTIONS = "Otter actions";
export const CHAT_OTTER_USAGE_CONVERSATIONS = "Chat conversations";
export const CHAT_OTTER_USAGE_MESSAGES = "Chat messages";
export const CHAT_OTTER_USAGE_AVG_TOKENS_PER_CHAT = "Avg tokens / chat";
export const CHAT_OTTER_USAGE_AVG_COST_PER_CHAT = "Avg cost / chat";
export const CHAT_OTTER_USAGE_PROVIDER_MODEL_SPEND = "Provider and model spend";
export const CHAT_OTTER_USAGE_WHERE_USED = "Where Otter was used";
export const CHAT_OTTER_USAGE_TYPE_CHAT = "Chat";
export const CHAT_OTTER_USAGE_TYPE_TRACE_ANALYSIS = "Trace analysis";
export const CHAT_OTTER_USAGE_TYPE_SPAN_ANALYSIS = "Span analysis";
export const CHAT_OTTER_USAGE_TYPE_PROMPT_IMPROVEMENT = "Prompt improvement";
export const CHAT_OTTER_USAGE_LOCATION_PROMPT_NEW = "New Prompt Hub improvement";
export const CHAT_OTTER_USAGE_LOCATION_PROMPT_EDIT = "Prompt Hub improvement";
export const CHAT_OTTER_USAGE_PROMPT_NEW_RUN = "New prompt improvement run";
export const CHAT_OTTER_USAGE_PROMPT_EDIT_RUN = "Prompt improvement run";
export const CHAT_OTTER_USAGE_UNKNOWN = "unknown";
export const CHAT_OTTER_USAGE_TOKENS = (tokens: number | string) =>
	`${tokens} tokens`;
export const CHAT_OTTER_USAGE_ACTION_COUNT = (count: number | string) =>
	`${count} actions`;
export const CHAT_REFRESH = "Refresh";

// Trace AI analysis
export const TRACE_AI_IMPROVEMENT_TITLE = "AI Improvement";
export const TRACE_AI_IMPROVEMENT_DESCRIPTION =
	"Trace hierarchy analysis stored separately from normal Otter chat";
export const TRACE_AI_IMPROVEMENT_SPAN_DESCRIPTION =
	"Analyzes this individual span — prompt, output, cost, latency, tools, and context";
export const TRACE_AI_DETAILS = "Details";
export const TRACE_AI_SUGGESTED_FIX = "Suggested fix";
export const TRACE_AI_TRY_IN_CHAT = "Try in Chat";
export const TRACE_AI_CHAT_PROMPT_COPIED = "Chat prompt copied";
export const TRACE_AI_CHAT_PROMPT_INTRO =
	"I need help exploring this improvement opportunity found in my LLM trace:";
export const TRACE_AI_CHAT_PROMPT_SPANS = "**Spans**:";
export const TRACE_AI_CHAT_PROMPT_ISSUE = "**Issue**:";
export const TRACE_AI_CHAT_PROMPT_DETAILS = "**Details**:";
export const TRACE_AI_CHAT_PROMPT_SUGGESTED_FIX = "**Suggested fix**:";
export const TRACE_AI_IMPROVEMENT_FLOW = "Improvement Flow";
export const TRACE_AI_ANALYSIS_RUNNING = "Analysis is running.";
export const TRACE_AI_ANALYZE = "Analyze";
export const TRACE_AI_RERUN = "Rerun";
export const TRACE_AI_ANALYZE_TRACE = "Analyze Trace";
export const TRACE_AI_TAB_TITLE = "AI Analysis";
export const TRACE_AI_LOAD_FAILED = "Failed to load AI improvement analysis";
export const TRACE_AI_RUN_FAILED = "Failed to run AI improvement analysis";
export const TRACE_AI_TIMEOUT = "Analysis timed out. Please try again.";
export const TRACE_AI_FALLBACK_TRACE_LABEL = "Trace analysis";
export const TRACE_AI_RUN_LABEL = (runNumber: number | string) => `Run ${runNumber}`;
export const TRACE_AI_RUNNING_LABEL = "Running";
export const TRACE_AI_TREND_VS_PREVIOUS = "vs previous run:";
export const TRACE_AI_TREND_NEW = (count: number | string) => `${count} new`;
export const TRACE_AI_TREND_RESOLVED = (count: number | string) =>
	`${count} resolved`;
export const TRACE_AI_TREND_NO_CHANGES = "no finding changes";
export const TRACE_AI_TREND_COST = (delta: number | string) => `cost ${delta}`;
export const TRACE_AI_SPAN_COUNT = (count: number | string) => `${count} spans`;
export const TRACE_AI_TOKEN_COUNT = (count: number | string) => `${count} tokens`;
export const TRACE_AI_DURATION_MS = (duration: number | string) => `${duration}ms`;
export const TRACE_AI_EMPTY_TITLE = "No analysis yet";
export const TRACE_AI_EMPTY_DESCRIPTION =
	"Run an AI improvement analysis to review prompts, responses, cost, tokens, latency, and hierarchy-level failure patterns.";
export const TRACE_AI_TOKENS_SAVED = (tokens: number | string) =>
	`${tokens} tokens saved`;
export const TRACE_AI_USD_SAVED = (usd: number | string) => `$${usd} saved`;
