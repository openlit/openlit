package tenant

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/openlit/openlit/otlp-receiver/internal/config"
	_ "modernc.org/sqlite"
)

func TestBearerToken(t *testing.T) {
	t.Parallel()
	if BearerToken("Bearer openlit-abc") != "openlit-abc" {
		t.Fatal("expected bearer token")
	}
	if BearerToken("bearer openlit-abc") != "openlit-abc" {
		t.Fatal("expected case-insensitive bearer")
	}
	if BearerToken("") != "" {
		t.Fatal("empty")
	}
}

func TestResolveRequiresKey(t *testing.T) {
	t.Parallel()
	s := &Store{RequireKey: true}
	_, err := s.Resolve(context.Background(), "")
	if err != ErrUnauthorized {
		t.Fatalf("got %v", err)
	}
}

func TestResolveInitDBFallback(t *testing.T) {
	t.Parallel()
	s := &Store{InitDB: config.ClickHouseConfig{Host: "ch", Port: "8123", Database: "openlit"}}
	cfg, err := s.Resolve(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "ch" || cfg.Database != "openlit" {
		t.Fatalf("unexpected %+v", cfg)
	}
}

func TestResolveAPIKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.db")
	s, err := Open(config.Config{SQLitePath: path, TenantCacheTTLSec: 30})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	_, err = s.db.Exec(`
		CREATE TABLE databaseconfig (
			id TEXT PRIMARY KEY,
			host TEXT,
			port TEXT,
			username TEXT,
			password TEXT,
			database TEXT
		);
		CREATE TABLE APIKeys (
			apiKey TEXT PRIMARY KEY,
			database_config_id TEXT,
			isDeleted INTEGER
		);
		INSERT INTO databaseconfig VALUES ('db-1', 'tenant-host', '8123', 'user', 'secret', 'orgdb');
		INSERT INTO APIKeys VALUES ('openlit-good', 'db-1', 0);
		INSERT INTO APIKeys VALUES ('openlit-deleted', 'db-1', 1);
	`)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := s.Resolve(context.Background(), "Bearer openlit-good")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "tenant-host" || cfg.Database != "orgdb" || cfg.Password != "secret" {
		t.Fatalf("unexpected %+v", cfg)
	}

	if _, err := s.Resolve(context.Background(), "Bearer openlit-deleted"); err != ErrUnauthorized {
		t.Fatalf("deleted key: %v", err)
	}
	if _, err := s.Resolve(context.Background(), "Bearer openlit-missing"); err != ErrUnauthorized {
		t.Fatalf("missing key: %v", err)
	}
	if _, err := s.Resolve(context.Background(), "Bearer openlit-good"); err != nil {
		t.Fatal("cached lookup failed")
	}
}
