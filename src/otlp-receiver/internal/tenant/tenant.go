package tenant

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/otlp-receiver/internal/config"

	_ "modernc.org/sqlite"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrNoTenant     = errors.New("no tenant")
)

type Store struct {
	db         *sql.DB
	RequireKey bool
	InitDB     config.ClickHouseConfig
	ttl        time.Duration
	mu         sync.Mutex
	cache      map[string]cacheEntry
}

type cacheEntry struct {
	cfg    config.ClickHouseConfig
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

func (s *Store) Resolve(ctx context.Context, authorization string) (config.ClickHouseConfig, error) {
	token := BearerToken(authorization)
	if token == "" {
		if s.RequireKey {
			return config.ClickHouseConfig{}, ErrUnauthorized
		}
		if s.InitDB.Host == "" {
			return config.ClickHouseConfig{}, ErrNoTenant
		}
		return s.InitDB, nil
	}
	if s.db == nil {
		return config.ClickHouseConfig{}, ErrUnauthorized
	}

	s.mu.Lock()
	if entry, ok := s.cache[token]; ok && time.Now().Before(entry.expiry) {
		cfg := entry.cfg
		s.mu.Unlock()
		return cfg, nil
	}
	s.mu.Unlock()

	row := s.db.QueryRowContext(ctx, `
		SELECT d.host, d.port, d.username, COALESCE(d.password, ''), d.database
		FROM APIKeys k
		JOIN databaseconfig d ON d.id = k.database_config_id
		WHERE k.apiKey = ? AND k.isDeleted = 0
		LIMIT 1
	`, token)

	var cfg config.ClickHouseConfig
	if err := row.Scan(&cfg.Host, &cfg.Port, &cfg.Username, &cfg.Password, &cfg.Database); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return config.ClickHouseConfig{}, ErrUnauthorized
		}
		return config.ClickHouseConfig{}, err
	}

	s.mu.Lock()
	s.cache[token] = cacheEntry{cfg: cfg, expiry: time.Now().Add(s.ttl)}
	s.mu.Unlock()
	return cfg, nil
}
