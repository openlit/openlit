package openlit

import "time"

type ControllerMode string

const (
	ModeLinux      ControllerMode = "linux"
	ModeDocker     ControllerMode = "docker"
	ModeKubernetes ControllerMode = "kubernetes"
)

// PollRequest is sent by the controller to OpenLIT on each poll cycle.
type PollRequest struct {
	InstanceID           string              `json:"instance_id"`
	Version              string              `json:"version"`
	Mode                 ControllerMode      `json:"mode"`
	NodeName             string              `json:"node_name"`
	ServicesDiscovered   int                 `json:"services_discovered"`
	ServicesInstrumented int                 `json:"services_instrumented"`
	Services             []DiscoveredService `json:"services"`
	ActionResults        []ActionResult      `json:"action_results,omitempty"`
}

// PollResponse is returned by OpenLIT with pending actions.
type PollResponse struct {
	Actions []PendingAction `json:"actions"`
}

type PendingAction struct {
	ID         string `json:"id"`
	ActionType string `json:"action_type"`
	ServiceKey string `json:"service_key"`
	Payload    string `json:"payload,omitempty"`
}

type ActionResult struct {
	ActionID string `json:"action_id"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
}

type DiscoveredService struct {
	ServiceName           string   `json:"service_name"`
	Namespace             string   `json:"namespace,omitempty"`
	LanguageRuntime       string   `json:"language_runtime,omitempty"`
	LLMProviders          []string `json:"llm_providers"`
	OpenPorts             []uint16 `json:"open_ports,omitempty"`
	DeploymentName        string   `json:"deployment_name,omitempty"`
	PID                   int      `json:"pid,omitempty"`
	ExePath               string   `json:"exe_path,omitempty"`
	InstrumentationStatus string   `json:"instrumentation_status"`
}

type ServiceState struct {
	ID                    string    `json:"id"`
	ServiceName           string    `json:"service_name"`
	Namespace             string    `json:"namespace,omitempty"`
	LanguageRuntime       string    `json:"language_runtime,omitempty"`
	LLMProviders          []string  `json:"llm_providers"`
	OpenPorts             []uint16  `json:"open_ports,omitempty"`
	DeploymentName        string    `json:"deployment_name,omitempty"`
	InstrumentationStatus string    `json:"instrumentation_status"`
	FirstSeen             time.Time `json:"first_seen"`
	LastSeen              time.Time `json:"last_seen"`
	PID                   int       `json:"pid,omitempty"`
	ExePath               string    `json:"exe_path,omitempty"`
	Cmdline               string    `json:"cmdline,omitempty"`
}
