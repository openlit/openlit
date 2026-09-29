package tenant

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/otlp-receiver/internal/config"
	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"

	_ "modernc.org/sqlite"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrNoTenant     = errors.New("no tenant")
)

type Tenant struct {
	ClickHouse     config.ClickHouseConfig
	OrganisationID string
	ProjectID      string
	Environment    string
}

func (t Tenant) Resource() otlpconv.ResourceTenant {
	return otlpconv.ResourceTenant{
		OrganisationID: t.OrganisationID,
		ProjectID:      t.ProjectID,
		Environment:    t.Environment,
	}
}

type Store struct {
	db         *sql.DB
	RequireKey bool
	InitDB     config.ClickHouseConfig
	ttl        time.Duration
	mu         sync.Mutex
	cache      map[string]cacheEntry
}

type cacheEntry struct {
	tenant Tenant
	expiry time.Time
}

func Open(cfg config.Config) (*Store, error) {
	s := &Store{
		RequireKey: cfg.RequireAPIKey,
		InitDB:     cfg.InitDB,
		ttl:        time.Duration(cfg.TenantCacheTTLSec) * time.Second,
		cache:      map[string]cacheEntry{},
	}
	if cfg.SQLitePath == "" {
		return s, nil
	}
	db, err := sql.Open("sqlite", cfg.SQLitePath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s.db = db
	return s, nil
}

func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func BearerToken(authorization string) string {
	authorization = strings.TrimSpace(authorization)
	if authorization == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(authorization) >= len(prefix) && strings.EqualFold(authorization[:len(prefix)], prefix) {
		return strings.TrimSpace(authorization[len(prefix):])
	}
	return ""
}

func (s *Store) Resolve(ctx context.Context, authorization string) (Tenant, error) {
	token := BearerToken(authorization)
	if token == "" {
		if s.RequireKey {
			return Tenant{}, ErrUnauthorized
		}
		if s.InitDB.Host == "" {
			return Tenant{}, ErrNoTenant
		}
		return Tenant{ClickHouse: s.InitDB}, nil
	}
	if s.db == nil {
		return Tenant{}, ErrUnauthorized
	}

	s.mu.Lock()
	if entry, ok := s.cache[token]; ok && time.Now().Before(entry.expiry) {
		tenant := entry.tenant
		s.mu.Unlock()
		return tenant, nil
	}
	s.mu.Unlock()

	tenant, err := s.lookupScoped(ctx, token)
	if err != nil && isMissingColumn(err) {
		tenant, err = s.lookupLegacy(ctx, token)
	}
	if err != nil {
		return Tenant{}, err
	}

	s.mu.Lock()
	s.cache[token] = cacheEntry{tenant: tenant, expiry: time.Now().Add(s.ttl)}
	s.mu.Unlock()
	return tenant, nil
}

func (s *Store) lookupScoped(ctx context.Context, token string) (Tenant, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT d.host, d.port, d.username, COALESCE(d.password, ''), d.database,
			COALESCE(NULLIF(k.organisation_id, ''), p.organisation_id, ''),
			COALESCE(NULLIF(k.project_id, ''), d.project_id, ''),
			COALESCE(NULLIF(k.environment, ''), NULLIF(d.environment, ''), 'production')
		FROM APIKeys k
		JOIN databaseconfig d ON d.id = k.database_config_id
		LEFT JOIN projects p ON p.id = COALESCE(NULLIF(k.project_id, ''), d.project_id)
		WHERE k.apiKey = ? AND k.isDeleted = 0
		LIMIT 1
	`, token)
	return scanTenant(row)
}

func (s *Store) lookupLegacy(ctx context.Context, token string) (Tenant, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT d.host, d.port, d.username, COALESCE(d.password, ''), d.database,
			COALESCE(p.organisation_id, ''),
			COALESCE(d.project_id, ''),
			COALESCE(NULLIF(d.environment, ''), 'production')
		FROM APIKeys k
		JOIN databaseconfig d ON d.id = k.database_config_id
		LEFT JOIN projects p ON p.id = d.project_id
		WHERE k.apiKey = ? AND k.isDeleted = 0
		LIMIT 1
	`, token)
	return scanTenant(row)
}

func scanTenant(row *sql.Row) (Tenant, error) {
	var tenant Tenant
	if err := row.Scan(
		&tenant.ClickHouse.Host,
		&tenant.ClickHouse.Port,
		&tenant.ClickHouse.Username,
		&tenant.ClickHouse.Password,
		&tenant.ClickHouse.Database,
		&tenant.OrganisationID,
		&tenant.ProjectID,
		&tenant.Environment,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Tenant{}, ErrUnauthorized
		}
		return Tenant{}, err
	}
	return tenant, nil
}

func isMissingColumn(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such column") || strings.Contains(msg, "has no column")
}
