export const DATABASE_CONFIG_NOT_FOUND = "No database config present!";
export const UNAUTHORIZED_USER = "Unauthorized user!";
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
	"Evaluation not run yet! Please run the evaluation to get results.";
export const EVALUATION_RUN = "Run Evaluation";
export const EVALUATION_RUN_AGAIN = "Run Evaluation Again";
export const EVALUATION_DATA_LOADING = "Loading evaluation data...";
export const EVALUATION_CREATED = "Evaluation created successfully!";
export const EVALUATION_UPDATED = "Evaluation updated successfully!";
export const EVALUATION_CONFIG_MODIFYING = "Modifying evaluation config...";
export const EVALUATION_CONFIG_INVALID = "Invalid evaluation config!";
export const EVALUATION_CONFIG_UPDATING_FAILED =
	"Evaluation config updation failed!";
export const EVALUATION_RUN_FAILURE = "Evaluation run failed!";

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
export const EVALUATION_MANUAL_FEEDBACK = "Manual Feedback";
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

// Features Title
export const FEATURE_OPENGROUND = "Openground";
export const FEATURE_PROMPTS = "Prompt Hub";
export const FEATURE_VAULT = "Vault";
export const FEATURE_FLEET_HUB = "Fleet Hub";


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
export const ADD_NEW_CONFIG = "Add New Config";
export const MANAGE_DB_CONFIG = "Manage DB Config";
export const PENDING_INVITATION = "Pending Invitation";

// Organisation
export const ORGANISATION = "Organisation";
export const ORGANISATIONS = "Organisations";
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
export const AUTH_FEATURE_INSTRUMENTATION = "Auto Instrumentation";
export const AUTH_FEATURE_INSTRUMENTATION_DESC = "One-line setup for 60+ AI providers";
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