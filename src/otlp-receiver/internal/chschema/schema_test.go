package chschema_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/openlit/openlit/otlp-receiver/internal/chschema"
)

func TestStatementsCoverOtelTables(t *testing.T) {
	t.Parallel()
	ddl := strings.Join(chschema.Statements(), "\n")
	if !strings.Contains(ddl, "`Events.Timestamp`") {
		t.Fatal("nested Event columns must be backtick-quoted for ClickHouse 24.4")
	}
	if !strings.Contains(ddl, "`ValueAtQuantiles.Quantile`") {
		t.Fatal("nested quantile columns must be backtick-quoted for ClickHouse 24.4")
	}
	for _, table := range chschema.RequiredTables() {
		if !strings.Contains(ddl, "CREATE TABLE IF NOT EXISTS "+table) {
			t.Fatalf("missing ddl for %s", table)
		}
	}
}

func TestIsMissingTable(t *testing.T) {
	t.Parallel()
	if chschema.IsMissingTable(nil) {
		t.Fatal("nil is not a missing table error")
	}
	if !chschema.IsMissingTable(errors.New("code: 60, message: Unknown table expression identifier 'otel_traces'")) {
		t.Fatal("UNKNOWN_TABLE-style errors must recreate schema")
	}
	if !chschema.IsMissingTable(errors.New("Table otel_metrics_histogram doesn't exist")) {
		t.Fatal("doesn't exist must recreate schema")
	}
	if chschema.IsMissingTable(errors.New("TOO_MANY_PARTS")) {
		t.Fatal("transient insert errors must not recreate schema")
	}
}

func TestForgetAllowsEnsureRetry(t *testing.T) {
	t.Parallel()
	chschema.Forget("test-fingerprint")
}
