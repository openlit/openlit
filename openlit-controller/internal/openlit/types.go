package openlit

import "time"

type ControllerMode string

const (
	ModeLinux      ControllerMode = "linux"
	ModeDocker     ControllerMode = "docker"
	ModeKubernetes ControllerMode = "kubernetes"
)

const (
	ActionInstrument       = "instrument"
	ActionUninstrument     = "uninstrument"
	ActionEnablePythonSDK  = "enable_python_sdk"
	ActionDisablePythonSDK = "disable_python_sdk"
	ActionStartWorkload    = "start_workload"
	ActionStopWorkload     = "stop_workload"
	ActionRestartWorkload  = "restart_workload"
)

// PollRequest is sent by the controller to OpenLIT on each poll cycle.
type PollRequest struct {
	InstanceID           string              `json:"instance_id"`
	ClusterID            string              `json:"cluster_id"`
	Version              string              `json:"version"`
	Mode                 ControllerMode      `json:"mode"`
	NodeName             string              `json:"node_name"`
	ServicesDiscovered   int                 `json:"services_discovered"`
	ServicesInstrumented int                 `json:"services_instrumented"`
	Services             []DiscoveredService `json:"services"`
	ActionResults        []ActionResult      `json:"action_results,omitempty"`
	ResourceAttributes   map[string]string   `json:"resource_attributes,omitempty"`
	ConfigHash           string              `json:"config_hash,omitempty"`
}

// PollResponse is returned by OpenLIT with pending actions.
type PollResponse struct {
	Actions       []PendingAction        `json:"actions"`
	ConfigChanged bool                   `json:"config_changed,omitempty"`
	Config        map[string]interface{} `json:"config,omitempty"`
	ConfigHash    string                 `json:"config_hash,omitempty"`
}

type PendingAction struct {
	ID         string `json:"id"`
	ActionType string `json:"action_type"`
	ServiceKey string `json:"service_key"`
	Payload    string `json:"payload,omitempty"`
}

type PythonSDKActionPayload struct {
	TargetRuntime          string            `json:"target_runtime"`
	InstrumentationProfile string            `json:"instrumentation_profile"`
	DuplicatePolicy        string            `json:"duplicate_policy"`
	ObservabilityScope     string            `json:"observability_scope"`
	OTLPEndpoint           string            `json:"otlp_endpoint,omitempty"`
	OTLPProtocol           string            `json:"otlp_protocol,omitempty"`
	OTLPHeaders            map[string]string `json:"otlp_headers,omitempty"`
	OTLPTracesEndpoint     string            `json:"otlp_traces_endpoint,omitempty"`
	OTLPMetricsEndpoint    string            `json:"otlp_metrics_endpoint,omitempty"`
	OTLPLogsEndpoint       string            `json:"otlp_logs_endpoint,omitempty"`
	SDKVersion             string            `json:"sdk_version,omitempty"`
	Environment            string            `json:"environment,omitempty"`
}

type ActionResult struct {
	ActionID string `json:"action_id"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	// Snapshot carries action-specific state back to the dashboard. For
	// stop_workload it holds a JSON blob describing how to recreate the
	// workload later (pod spec for K8s naked pods, exe+args+cwd+env subset
	// for bare Linux processes). The dashboard persists this into the
	// matching openlit_controller_desired_states_v2.config row so a later
	// start_workload action can hand it back to the controller.
	Snapshot string `json:"snapshot,omitempty"`
}

type DiscoveredService struct {
	ServiceName              string   `json:"service_name"`
	WorkloadKey              string   `json:"workload_key,omitempty"`
	Namespace                string   `json:"namespace,omitempty"`
	LanguageRuntime          string   `json:"language_runtime,omitempty"`
	LLMProviders             []string `json:"llm_providers"`
	OpenPorts                []uint16 `json:"open_ports,omitempty"`
	DeploymentName           string   `json:"deployment_name,omitempty"`
	PID                      int      `json:"pid,omitempty"`
	ExePath                  string   `json:"exe_path,omitempty"`
	InstrumentationStatus    string   `json:"instrumentation_status"`
	AgentObservabilityStatus string   `json:"agent_observability_status,omitempty"`
	AgentObservabilitySource string   `json:"agent_observability_source,omitempty"`
	ObservabilityConflict    string   `json:"observability_conflict,omitempty"`
	ObservabilityReason      string   `json:"observability_reason,omitempty"`
	// LifecycleStatus is the controller's last-known lifecycle state for the
	// workload ("running"/"stopped"/"restarting"). Echoed via
	// resource_attributes["openlit.lifecycle.status"] for the dashboard rollup.
	LifecycleStatus    string            `json:"lifecycle_status,omitempty"`
	FirstSeen          string            `json:"first_seen,omitempty"`
	ResourceAttributes map[string]string `json:"resource_attributes,omitempty"`
}

type ServiceState struct {
	ID                              string            `json:"id"`
	ServiceName                     string            `json:"service_name"`
	WorkloadKey                     string            `json:"workload_key,omitempty"`
	Namespace                       string            `json:"namespace,omitempty"`
	LanguageRuntime                 string            `json:"language_runtime,omitempty"`
	LLMProviders                    []string          `json:"llm_providers"`
	OpenPorts                       []uint16          `json:"open_ports,omitempty"`
	DeploymentName                  string            `json:"deployment_name,omitempty"`
	InstrumentationStatus           string            `json:"instrumentation_status"`
	AgentObservabilityStatus        string            `json:"agent_observability_status,omitempty"`
	AgentObservabilitySource        string            `json:"agent_observability_source,omitempty"`
	ObservabilityConflict           string            `json:"observability_conflict,omitempty"`
	ObservabilityReason             string            `json:"observability_reason,omitempty"`
	LifecycleStatus                 string            `json:"lifecycle_status,omitempty"`
	FirstSeen                       time.Time         `json:"first_seen"`
	LastSeen                        time.Time         `json:"last_seen"`
	PID                             int               `json:"pid,omitempty"`
	ExePath                         string            `json:"exe_path,omitempty"`
	Cmdline                         string            `json:"cmdline,omitempty"`
	ResourceAttributes              map[string]string `json:"resource_attributes,omitempty"`
	DesiredAgentObservabilityStatus string            `json:"-"`
	DesiredAgentObservabilityReason string            `json:"-"`
}
