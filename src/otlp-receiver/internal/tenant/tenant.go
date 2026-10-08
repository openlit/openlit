package tenant

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
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

const negativeCacheTTL = 10 * time.Second

type Tenant struct {
	ClickHouse       config.ClickHouseConfig
	OrganisationID   string
	ProjectID        string
	Environment      string
	DatabaseConfigID string
	APIKeyID         string
	// Scoped is true only when the key resolved to a project-bound
	// DatabaseConfig with a known organisation. Unscoped tenants keep writing
	// for compatibility but must never be fanned out to the realtime bus.
	Scoped bool
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
	err    error
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

// Credential normalises the two accepted key carriers (Authorization: Bearer
// and x-openlit-api-key) into a single Authorization value.
func Credential(authorization, apiKeyHeader string) string {
	if strings.TrimSpace(authorization) != "" {
		return authorization
	}
	if key := strings.TrimSpace(apiKeyHeader); key != "" {
		return "Bearer " + key
	}
	return ""
}

func cacheKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
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

	key := cacheKey(token)
	s.mu.Lock()
	if s.cache == nil {
		s.cache = map[string]cacheEntry{}
	}
	if entry, ok := s.cache[key]; ok && time.Now().Before(entry.expiry) {
		s.mu.Unlock()
		return entry.tenant, entry.err
	}
	s.mu.Unlock()

	tenant, err := s.lookupScoped(ctx, token)
	if err != nil && isMissingColumn(err) {
		tenant, err = s.lookupLegacy(ctx, token)
	}
	if err != nil && !errors.Is(err, ErrUnauthorized) {
		return Tenant{}, err
	}

	s.mu.Lock()
	if err != nil {
		s.cache[key] = cacheEntry{err: err, expiry: time.Now().Add(negativeCacheTTL)}
	} else {
		s.cache[key] = cacheEntry{tenant: tenant, expiry: time.Now().Add(s.ttl)}
	}
	s.mu.Unlock()
	return tenant, err
}

type resolvedRow struct {
	tenant        Tenant
	configProject string
	keyProject    string
	configOrg     string
	keyOrg        string
}

// The DatabaseConfig is authoritative for (project, environment): the key only
// selects it. A key whose stored project/organisation disagrees with its
// config is rejected rather than stamped with the wrong tenant.
func (s *Store) lookupScoped(ctx context.Context, token string) (Tenant, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT k.id, d.id, d.host, d.port, d.username, COALESCE(d.password, ''), d.database,
			COALESCE(d.project_id, ''), COALESCE(k.project_id, ''),
			COALESCE(p.organisation_id, ''), COALESCE(k.organisation_id, ''),
			COALESCE(NULLIF(trim(d.environment), ''), 'production')
		FROM APIKeys k
		JOIN databaseconfig d ON d.id = k.database_config_id
		LEFT JOIN projects p ON p.id = COALESCE(NULLIF(d.project_id, ''), NULLIF(k.project_id, ''))
		WHERE k.apiKey = ? AND k.isDeleted = 0
		LIMIT 1
	`, token)
	var r resolvedRow
	if err := row.Scan(
		&r.tenant.APIKeyID,
		&r.tenant.DatabaseConfigID,
		&r.tenant.ClickHouse.Host,
		&r.tenant.ClickHouse.Port,
		&r.tenant.ClickHouse.Username,
		&r.tenant.ClickHouse.Password,
		&r.tenant.ClickHouse.Database,
		&r.configProject,
		&r.keyProject,
		&r.configOrg,
		&r.keyOrg,
		&r.tenant.Environment,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Tenant{}, ErrUnauthorized
		}
		return Tenant{}, err
	}
	return finalize(r)
}

func (s *Store) lookupLegacy(ctx context.Context, token string) (Tenant, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT k.id, d.id, d.host, d.port, d.username, COALESCE(d.password, ''), d.database,
			COALESCE(d.project_id, ''),
			COALESCE(p.organisation_id, ''),
			COALESCE(NULLIF(trim(d.environment), ''), 'production')
		FROM APIKeys k
		JOIN databaseconfig d ON d.id = k.database_config_id
		LEFT JOIN projects p ON p.id = d.project_id
		WHERE k.apiKey = ? AND k.isDeleted = 0
		LIMIT 1
	`, token)
	var r resolvedRow
	if err := row.Scan(
		&r.tenant.APIKeyID,
		&r.tenant.DatabaseConfigID,
		&r.tenant.ClickHouse.Host,
		&r.tenant.ClickHouse.Port,
		&r.tenant.ClickHouse.Username,
		&r.tenant.ClickHouse.Password,
		&r.tenant.ClickHouse.Database,
		&r.configProject,
		&r.configOrg,
		&r.tenant.Environment,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Tenant{}, ErrUnauthorized
		}
		return Tenant{}, err
	}
	return finalize(r)
}

func finalize(r resolvedRow) (Tenant, error) {
	t := r.tenant
	if r.configProject != "" && r.keyProject != "" && r.configProject != r.keyProject {
		log.Printf("tenant: api key %s rejected: project does not match database config %s", t.APIKeyID, t.DatabaseConfigID)
		return Tenant{}, ErrUnauthorized
	}
	if r.configOrg != "" && r.keyOrg != "" && r.configOrg != r.keyOrg {
		log.Printf("tenant: api key %s rejected: organisation does not match database config %s", t.APIKeyID, t.DatabaseConfigID)
		return Tenant{}, ErrUnauthorized
	}
	t.ProjectID = r.configProject
	if t.ProjectID == "" {
		t.ProjectID = r.keyProject
	}
	t.OrganisationID = r.configOrg
	if t.OrganisationID == "" {
		t.OrganisationID = r.keyOrg
	}
	t.Scoped = r.configProject != "" && t.OrganisationID != ""
	return t, nil
}

func isMissingColumn(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such column") || strings.Contains(msg, "has no column")
}
