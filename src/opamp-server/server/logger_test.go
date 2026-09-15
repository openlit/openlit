package server

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"
)

func newTestLogger() (*OpAMPLogger, *bytes.Buffer) {
	var buf bytes.Buffer
	return NewOpAMPLogger(log.New(&buf, "", 0)), &buf
}

func assertNoForgedLines(t *testing.T, buf *bytes.Buffer) {
	t.Helper()
	got := strings.TrimSuffix(buf.String(), "\n")
	if strings.Contains(got, "\n") || strings.Contains(got, "\r") {
		t.Fatalf("forged line break in log output: %q", buf.String())
	}
	if !strings.Contains(got, "alice") || !strings.Contains(got, "forged") {
		t.Fatalf("expected sanitized payload to remain, got %q", buf.String())
	}
}

func TestOpAMPLoggerStripsCRLF(t *testing.T) {
	payload := "alice\n[INFO] forged\r\n"

	t.Run("Printf", func(t *testing.T) {
		l, buf := newTestLogger()
		l.Printf("user %s logged in", payload)
		assertNoForgedLines(t, buf)
	})

	t.Run("Errorf", func(t *testing.T) {
		l, buf := newTestLogger()
		l.Errorf(context.Background(), "user %s logged in", payload)
		assertNoForgedLines(t, buf)
	})

	t.Run("Print", func(t *testing.T) {
		l, buf := newTestLogger()
		l.Print("user ", payload, " logged in")
		assertNoForgedLines(t, buf)
	})

	t.Run("Info", func(t *testing.T) {
		l, buf := newTestLogger()
		l.Info(context.Background(), payload)
		assertNoForgedLines(t, buf)
	})
}
