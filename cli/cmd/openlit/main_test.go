package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestExecuteReportsUserFacingErrors(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		wantText string
	}{
		{
			name:     "unknown doctor flag",
			args:     []string{"doctor", "--definitely-invalid"},
			wantText: "unknown flag: --definitely-invalid",
		},
		{
			name:     "invalid configure value",
			args:     []string{"configure", "--content-capture", "oops"},
			wantText: `invalid --content-capture "oops"`,
		},
		{
			name:     "missing install vendor",
			args:     []string{"coding", "install"},
			wantText: `required flag(s) "vendor" not set`,
		},
		{
			name:     "unknown root command",
			args:     []string{"definitely-invalid"},
			wantText: `unknown command "definitely-invalid" for "openlit"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stdout bytes.Buffer
			var stderr bytes.Buffer

			exitCode := execute(tt.args, &stdout, &stderr)

			if exitCode != 1 {
				t.Fatalf("execute() exit code = %d, want 1", exitCode)
			}
			if stdout.Len() != 0 {
				t.Errorf("execute() stdout = %q, want empty", stdout.String())
			}
			if !strings.Contains(stderr.String(), tt.wantText) {
				t.Errorf("execute() stderr = %q, want it to contain %q", stderr.String(), tt.wantText)
			}
			if count := strings.Count(stderr.String(), tt.wantText); count != 1 {
				t.Errorf("execute() stderr contains error %d times, want once: %q", count, stderr.String())
			}
			if strings.Contains(stderr.String(), "Usage:") {
				t.Errorf("execute() stderr contains usage output: %q", stderr.String())
			}
		})
	}
}
