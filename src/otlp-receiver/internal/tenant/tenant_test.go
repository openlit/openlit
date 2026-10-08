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

func TestCredential(t *testing.T) {
	t.Parallel()
	if got := Credential("Bearer a", "b"); got != "Bearer a" {
		t.Fatalf("authorization must win, got %q", got)
	}
	if got := Credential("", " b "); got != "Bearer b" {
		t.Fatalf("api key header, got %q", got)
	}
	if got := Credential("", ""); got != "" {
		t.Fatalf("empty, got %q", got)
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
	if cfg.ClickHouse.Host != "ch" || cfg.ClickHouse.Database != "openlit" {
		t.Fatalf("unexpected %+v", cfg)
	}
	if cfg.Environment != "" {
		t.Fatal("init-db fallback must not invent an environment")
	}
	if cfg.Scoped {
		t.Fatal("init-db fallback must be unscoped")
	}
}

const scopedSchema = `
	CREATE TABLE organisations (id TEXT PRIMARY KEY);
	CREATE TABLE projects (id TEXT PRIMARY KEY, organisation_id TEXT);
	CREATE TABLE databaseconfig (
		id TEXT PRIMARY KEY, host TEXT, port TEXT, username TEXT, password TEXT,
		database TEXT, project_id TEXT, environment TEXT
	);
	CREATE TABLE APIKeys (
		id TEXT PRIMARY KEY, apiKey TEXT UNIQUE, database_config_id TEXT,
		organisation_id TEXT, project_id TEXT, environment TEXT, isDeleted INTEGER
	);
	INSERT INTO organisations VALUES ('org-1'), ('org-2');
	INSERT INTO projects VALUES ('proj-1', 'org-1'), ('proj-2', 'org-2');
	INSERT INTO databaseconfig VALUES ('db-1', 'tenant-host', '8123', 'user', 'secret', 'orgdb', 'proj-1', 'staging');
	INSERT INTO databaseconfig VALUES ('db-legacy', 'legacy-host', '8123', 'user', '', 'legacydb', NULL, 'production');
`

func openStore(t *testing.T, schema string) *Store {
	t.Helper()
	s, err := Open(config.Config{SQLitePath: filepath.Join(t.TempDir(), "data.db"), TenantCacheTTLSec: 30})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestResolveAPIKey(t *testing.T) {
	s := openStore(t, scopedSchema+`
		INSERT INTO APIKeys VALUES ('k-good', 'openlit-good', 'db-1', 'org-1', 'proj-1', 'staging', 0);
		INSERT INTO APIKeys VALUES ('k-del', 'openlit-deleted', 'db-1', 'org-1', 'proj-1', 'staging', 1);
	`)

	cfg, err := s.Resolve(context.Background(), "Bearer openlit-good")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ClickHouse.Host != "tenant-host" || cfg.ClickHouse.Database != "orgdb" || cfg.ClickHouse.Password != "secret" {
		t.Fatalf("unexpected %+v", cfg.ClickHouse)
	}
	if cfg.OrganisationID != "org-1" || cfg.ProjectID != "proj-1" || cfg.Environment != "staging" {
		t.Fatalf("unexpected scope %+v", cfg)
	}
	if cfg.APIKeyID != "k-good" || cfg.DatabaseConfigID != "db-1" || !cfg.Scoped {
		t.Fatalf("unexpected ids %+v", cfg)
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

func TestEnvironmentComesFromDatabaseConfig(t *testing.T) {
	// A key left on "production" after its config moved to "staging" must
	// stamp the environment of the store it actually writes to.
	s := openStore(t, scopedSchema+`
		INSERT INTO APIKeys VALUES ('k-drift', 'openlit-drift', 'db-1', 'org-1', 'proj-1', 'production', 0);
	`)
	cfg, err := s.Resolve(context.Background(), "Bearer openlit-drift")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Environment != "staging" {
		t.Fatalf("environment = %q, want staging", cfg.Environment)
	}
}

func TestRejectsKeyProjectMismatch(t *testing.T) {
	s := openStore(t, scopedSchema+`
		INSERT INTO APIKeys VALUES ('k-x', 'openlit-cross', 'db-1', 'org-2', 'proj-2', 'staging', 0);
		INSERT INTO APIKeys VALUES ('k-o', 'openlit-org', 'db-1', 'org-2', 'proj-1', 'staging', 0);
	`)
	if _, err := s.Resolve(context.Background(), "Bearer openlit-cross"); err != ErrUnauthorized {
		t.Fatalf("cross-project key: %v", err)
	}
	if _, err := s.Resolve(context.Background(), "Bearer openlit-org"); err != ErrUnauthorized {
		t.Fatalf("cross-org key: %v", err)
	}
}

func TestUnscopedConfigIsNotScoped(t *testing.T) {
	s := openStore(t, scopedSchema+`
		INSERT INTO APIKeys VALUES ('k-l', 'openlit-legacy', 'db-legacy', NULL, NULL, 'production', 0);
	`)
	cfg, err := s.Resolve(context.Background(), "Bearer openlit-legacy")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Scoped || cfg.ProjectID != "" {
		t.Fatalf("legacy config must be unscoped, got %+v", cfg)
	}
}

func TestNegativeCache(t *testing.T) {
	s := openStore(t, scopedSchema)
	if _, err := s.Resolve(context.Background(), "Bearer openlit-late"); err != ErrUnauthorized {
		t.Fatalf("got %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO APIKeys VALUES ('k-late', 'openlit-late', 'db-1', 'org-1', 'proj-1', 'staging', 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Resolve(context.Background(), "Bearer openlit-late"); err != ErrUnauthorized {
		t.Fatalf("negative cache should still reject, got %v", err)
	}
	for k := range s.cache {
		if k == "openlit-late" {
			t.Fatal("cache must not hold raw keys")
		}
	}
}

func TestResolveAPIKeyLegacyColumns(t *testing.T) {
	s := openStore(t, `
		CREATE TABLE projects (id TEXT PRIMARY KEY, organisation_id TEXT);
		CREATE TABLE databaseconfig (
			id TEXT PRIMARY KEY, host TEXT, port TEXT, username TEXT, password TEXT,
			database TEXT, project_id TEXT, environment TEXT
		);
		CREATE TABLE APIKeys (id TEXT PRIMARY KEY, apiKey TEXT, database_config_id TEXT, isDeleted INTEGER);
		INSERT INTO projects VALUES ('proj-1', 'org-1');
		INSERT INTO databaseconfig VALUES ('db-1', 'tenant-host', '8123', 'user', 'secret', 'orgdb', 'proj-1', 'production');
		INSERT INTO APIKeys VALUES ('k-1', 'openlit-good', 'db-1', 0);
	`)
	cfg, err := s.Resolve(context.Background(), "Bearer openlit-good")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OrganisationID != "org-1" || cfg.ProjectID != "proj-1" || cfg.Environment != "production" || !cfg.Scoped {
		t.Fatalf("unexpected legacy scope %+v", cfg)
	}
}
