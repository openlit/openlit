package openlit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// RuleEntityType constrains the entity_type values accepted by the rule engine.
type RuleEntityType string

const (
	// RuleEntityContext matches rules that return context entities.
	RuleEntityContext RuleEntityType = "context"
	// RuleEntityPrompt matches rules that return prompt entities.
	RuleEntityPrompt RuleEntityType = "prompt"
	// RuleEntityEvaluation matches rules that return evaluation entities.
	RuleEntityEvaluation RuleEntityType = "evaluation"
)

// EvaluateRuleOptions holds parameters for the EvaluateRule call.
type EvaluateRuleOptions struct {
	// URL is the OpenLIT dashboard base URL.
	// Falls back to OPENLIT_URL env var, then http://127.0.0.1:3000.
	URL string

	// APIKey is the Bearer token for authentication.
	// Falls back to OPENLIT_API_KEY env var.
	APIKey string

	// EntityType specifies which kind of entities to match ("context", "prompt", or "evaluation").
	EntityType RuleEntityType

	// Fields are the trace attributes to evaluate against rules.
	// Example: {"gen_ai.system": "openai", "gen_ai.request.model": "gpt-4"}
	Fields map[string]interface{}

	// IncludeEntityData requests full entity data in the response when true.
	IncludeEntityData bool

	// EntityInputs provides optional inputs for entity resolution (e.g. prompt variables).
	EntityInputs map[string]interface{}

	// Timeout for the HTTP request. Defaults to 30 seconds.
	Timeout time.Duration
}

// RuleEntity represents a single matched rule-entity association.
type RuleEntity struct {
	RuleID     string `json:"rule_id"`
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
}

// EvaluateRuleResult is the parsed response from the rule engine evaluate endpoint.
type EvaluateRuleResult struct {
	MatchingRuleIDs []string               `json:"matchingRuleIds"`
	Entities        []RuleEntity           `json:"entities"`
	EntityData      map[string]interface{} `json:"entity_data,omitempty"`
}

// EvaluateRule calls the OpenLIT dashboard rule-engine evaluate endpoint.
// It sends the provided fields against configured rules and returns matching
// rule IDs, associated entities, and optionally the full entity data.
//
// This function does NOT require openlit.Init() — it is a standalone HTTP
// call, consistent with get_prompt/get_secrets in the Python and TypeScript SDKs.
//
// Example:
//
//	result, err := openlit.EvaluateRule(ctx, openlit.EvaluateRuleOptions{
//	    EntityType: openlit.RuleEntityContext,
//	    Fields: map[string]interface{}{
//	        "gen_ai.system":        "openai",
//	        "gen_ai.request.model": "gpt-4",
//	        "service.name":         "my-app",
//	    },
//	    IncludeEntityData: true,
//	})
func EvaluateRule(ctx context.Context, opts EvaluateRuleOptions) (*EvaluateRuleResult, error) {
	// Resolve URL
	url := opts.URL
	if url == "" {
		url = os.Getenv("OPENLIT_URL")
	}
	if url == "" {
		url = "http://127.0.0.1:3000"
	}

	// Resolve API key
	apiKey := opts.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("OPENLIT_API_KEY")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("openlit: missing API key, provide APIKey or set OPENLIT_API_KEY")
	}

	// Build payload
	payload := map[string]interface{}{
		"entity_type":         opts.EntityType,
		"fields":              opts.Fields,
		"include_entity_data": opts.IncludeEntityData,
		"source":              "go-sdk",
	}
	if opts.EntityInputs != nil {
		payload["entity_inputs"] = opts.EntityInputs
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("openlit: failed to marshal request: %w", err)
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api/rule-engine/evaluate", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("openlit: failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openlit: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openlit: server returned status %d", resp.StatusCode)
	}

	var result EvaluateRuleResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("openlit: failed to decode response: %w", err)
	}
	return &result, nil
}
