// Tests the JSON wire format of lifecycleK8sPodSnapshot — the blob the
// controller returns from Stop, the dashboard persists into
// desired_states_v2.config, and the controller decodes on the next
// Start. Both fields are `omitempty` so each snapshot kind serialises
// to a different shape; if that invariant breaks, the dashboard's
// requiresSnapshot check in lifecycle.ts and the controller's
// startK8s dispatch in this file silently misbehave.

package engine

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLifecycleK8sSnapshot_ControlledJSON(t *testing.T) {
	snap := lifecycleK8sPodSnapshot{
		Controlled: &lifecycleK8sControlledSnapshot{
			Kind:          "Deployment",
			Namespace:     "default",
			Name:          "demo-openai-app",
			ContainerName: "demo-openai-app",
		},
	}
	out, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(out)
	// The dashboard's requiresSnapshot path treats "" and "{}" as
	// empty. We want a non-empty body for controlled workloads so the
	// poll route persists it.
	if got == "{}" || got == "" {
		t.Fatalf("controlled snapshot serialised as empty: %q", got)
	}
	// Naked-pod field must be absent for a controlled snapshot so the
	// startK8s dispatcher does not race the wrong branch.
	if strings.Contains(got, "gzipped_pod_b64") {
		t.Fatalf("controlled snapshot leaked gzipped_pod_b64: %q", got)
	}
	if !strings.Contains(got, "\"controlled\"") {
		t.Fatalf("expected controlled key in JSON, got %q", got)
	}

	// Round-trip must preserve every field.
	var back lifecycleK8sPodSnapshot
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.Controlled == nil {
		t.Fatalf("round-trip lost controlled struct")
	}
	if back.Controlled.Kind != "Deployment" ||
		back.Controlled.Namespace != "default" ||
		back.Controlled.Name != "demo-openai-app" ||
		back.Controlled.ContainerName != "demo-openai-app" {
		t.Fatalf("round-trip mangled fields: %+v", back.Controlled)
	}
	if back.GzippedPodB64 != "" {
		t.Fatalf("round-trip resurrected gzipped_pod_b64")
	}
}

func TestLifecycleK8sSnapshot_NakedPodJSON(t *testing.T) {
	snap := lifecycleK8sPodSnapshot{
		GzippedPodB64: "H4sIAAAA",
	}
	out, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(out)
	if strings.Contains(got, "\"controlled\"") {
		t.Fatalf("naked-pod snapshot leaked controlled key: %q", got)
	}
	if !strings.Contains(got, "gzipped_pod_b64") {
		t.Fatalf("missing gzipped_pod_b64: %q", got)
	}
}

func TestValidateBareProcessArgs(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		wantErr bool
	}{
		{
			name: "happy path: absolute path",
			args: []string{"/usr/bin/python3", "myapp.py"},
		},
		{
			name: "happy path: PATH-resolved binary",
			args: []string{"python3", "-m", "myapp"},
		},
		{
			name: "happy path: relative argv[0]",
			args: []string{"./run.sh", "--flag"},
		},
		{
			name:    "empty argv",
			args:    nil,
			wantErr: true,
		},
		{
			name:    "empty argv[0]",
			args:    []string{"", "myapp.py"},
			wantErr: true,
		},
		{
			name:    "NUL in argv[0]",
			args:    []string{"python\x003", "myapp.py"},
			wantErr: true,
		},
		{
			name:    "NUL in middle argv",
			args:    []string{"python3", "my\x00app.py"},
			wantErr: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateBareProcessArgs(tc.args)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateBareProcessArgs(%v): err=%v, wantErr=%v", tc.args, err, tc.wantErr)
			}
		})
	}
}

func TestLifecycleK8sSnapshot_DispatchDiscriminator(t *testing.T) {
	// Mirrors the dispatch in startK8s: a controlled blob is detected
	// by parsed.Controlled != nil, a naked pod blob by
	// parsed.GzippedPodB64 != "". Each input goes down exactly one
	// branch.
	tests := []struct {
		name           string
		payload        string
		wantControlled bool
		wantNakedPod   bool
	}{
		{
			name:           "controlled",
			payload:        `{"controlled":{"kind":"Deployment","namespace":"x","name":"y"}}`,
			wantControlled: true,
		},
		{
			name:         "naked_pod",
			payload:      `{"gzipped_pod_b64":"abc"}`,
			wantNakedPod: true,
		},
		{
			name:    "empty",
			payload: `{}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var parsed lifecycleK8sPodSnapshot
			if err := json.Unmarshal([]byte(tc.payload), &parsed); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			gotControlled := parsed.Controlled != nil
			gotNakedPod := parsed.GzippedPodB64 != ""
			if gotControlled != tc.wantControlled {
				t.Errorf("controlled: got %v want %v", gotControlled, tc.wantControlled)
			}
			if gotNakedPod != tc.wantNakedPod {
				t.Errorf("naked pod: got %v want %v", gotNakedPod, tc.wantNakedPod)
			}
		})
	}
}
