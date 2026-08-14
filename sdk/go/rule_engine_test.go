package openlit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestEvaluateRule_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/rule-engine/evaluate" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected auth header: %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected content-type: %s", r.Header.Get("Content-Type"))
		}

		// Decode and verify request body
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if body["entity_type"] != "context" {
			t.Errorf("expected entity_type=context, got %v", body["entity_type"])
		}
		if body["source"] != "go-sdk" {
			t.Errorf("expected source=go-sdk, got %v", body["source"])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"matchingRuleIds": []string{"rule-1"},
			"entities": []map[string]string{
				{"rule_id": "rule-1", "entity_type": "context", "entity_id": "ctx-1"},
			},
		})
	}))
	defer srv.Close()

	result, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		URL:        srv.URL,
		APIKey:     "test-key",
		EntityType: RuleEntityContext,
		Fields: map[string]interface{}{
			"gen_ai.system": "openai",
		},
	})

	if err != nil {
		t.Fatalf("EvaluateRule: %v", err)
	}
	if len(result.MatchingRuleIDs) != 1 || result.MatchingRuleIDs[0] != "rule-1" {
		t.Errorf("unexpected matchingRuleIds: %v", result.MatchingRuleIDs)
	}
	if len(result.Entities) != 1 || result.Entities[0].EntityID != "ctx-1" {
		t.Errorf("unexpected entities: %v", result.Entities)
	}
}

func TestEvaluateRule_WithEntityData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		if body["include_entity_data"] != true {
			t.Errorf("expected include_entity_data=true, got %v", body["include_entity_data"])
		}
		if body["entity_type"] != string(RuleEntityPrompt) {
			t.Errorf("expected entity_type=prompt, got %v", body["entity_type"])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"matchingRuleIds": []string{},
			"entities":        []interface{}{},
			"entity_data":     map[string]interface{}{"prompt": "Hello"},
		})
	}))
	defer srv.Close()

	result, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		URL:               srv.URL,
		APIKey:            "test-key",
		EntityType:        RuleEntityPrompt,
		Fields:            map[string]interface{}{"key": "val"},
		IncludeEntityData: true,
		EntityInputs:      map[string]interface{}{"variables": map[string]string{"name": "test"}},
	})

	if err != nil {
		t.Fatalf("EvaluateRule: %v", err)
	}
	if result.EntityData == nil {
		t.Fatal("expected entity_data to be present")
	}
	if result.EntityData["prompt"] != "Hello" {
		t.Errorf("unexpected entity_data: %v", result.EntityData)
	}
}

func TestEvaluateRule_MissingAPIKey(t *testing.T) {
	os.Unsetenv("OPENLIT_API_KEY")

	_, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		URL:        "http://localhost:3000",
		EntityType: RuleEntityContext,
		Fields:     map[string]interface{}{},
	})

	if err == nil {
		t.Fatal("expected error for missing API key")
	}
	if !strings.Contains(err.Error(), "missing API key") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestEvaluateRule_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		URL:        srv.URL,
		APIKey:     "test-key",
		EntityType: RuleEntityContext,
		Fields:     map[string]interface{}{},
	})

	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 in error, got: %v", err)
	}
}

func TestEvaluateRule_EnvVarFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer env-key" {
			t.Errorf("expected env API key, got: %s", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"matchingRuleIds": []string{},
			"entities":        []interface{}{},
		})
	}))
	defer srv.Close()

	os.Setenv("OPENLIT_URL", srv.URL)
	os.Setenv("OPENLIT_API_KEY", "env-key")
	defer os.Unsetenv("OPENLIT_URL")
	defer os.Unsetenv("OPENLIT_API_KEY")

	result, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		EntityType: RuleEntityContext,
		Fields:     map[string]interface{}{"key": "val"},
	})

	if err != nil {
		t.Fatalf("EvaluateRule: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestEvaluateRule_CustomTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"matchingRuleIds": []string{},
			"entities":        []interface{}{},
		})
	}))
	defer srv.Close()

	// Very short timeout should fail
	_, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		URL:        srv.URL,
		APIKey:     "test-key",
		EntityType: RuleEntityContext,
		Fields:     map[string]interface{}{},
		Timeout:    1 * time.Millisecond,
	})

	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestEvaluateRule_DefaultURL(t *testing.T) {
	os.Unsetenv("OPENLIT_URL")

	// This will fail to connect but we can check the error contains the default URL
	_, err := EvaluateRule(context.Background(), EvaluateRuleOptions{
		APIKey:     "test-key",
		EntityType: RuleEntityContext,
		Fields:     map[string]interface{}{},
		Timeout:    100 * time.Millisecond,
	})

	// Should fail with connection refused (default localhost:3000)
	if err == nil {
		t.Fatal("expected connection error to default URL")
	}
}

func TestRuleEntityType_Constants(t *testing.T) {
	if RuleEntityContext != "context" {
		t.Errorf("RuleEntityContext = %q, want %q", RuleEntityContext, "context")
	}
	if RuleEntityPrompt != "prompt" {
		t.Errorf("RuleEntityPrompt = %q, want %q", RuleEntityPrompt, "prompt")
	}
	if RuleEntityEvaluation != "evaluation" {
		t.Errorf("RuleEntityEvaluation = %q, want %q", RuleEntityEvaluation, "evaluation")
	}
}
