package auth

import (
	"database/sql"
	"fmt"
	"time"

	"ingester/db"
	"github.com/rs/zerolog/log"
)

var (
	// CacheEntryDuration defines how long an item should stay in the cache before being re-validated.
	CacheEntryDuration = time.Minute * 10
)

// cacheEntry represents an entry in the API key cache.
type cacheEntry struct {
	Name      string
	Timestamp time.Time
}

// InitializeCacheEviction sets up periodic eviction of expired cache entries.
func InitializeCacheEviction() {
	go func() {
		ticker := time.NewTicker(CacheEntryDuration)
		defer ticker.Stop()

		for {
			<-ticker.C // This blocks until the ticker sends a value
			log.Info().Msg("Evicting Expired API Key Cache Entries")
			evictExpiredEntries()
			db.EvictExpiredEntries()
		}
	}()
}

// EvictExpiredEntries goes through the cache and evicts expired entries.
func evictExpiredEntries() {
	now := time.Now()
	db.ApiKeyCache.Range(func(key, value interface{}) bool {
		if entry, ok := value.(cacheEntry); ok {
			if now.Sub(entry.Timestamp) >= CacheEntryDuration {
				db.ApiKeyCache.Delete(key)
			}
		}
		return true
	})
}

// AuthenticateRequest checks the provided API key against the known keys.
func AuthenticateRequest(apiKey string) (string, error) {
	/// Attempt to retrieve API Key from the cache.
	if val, ok := db.ApiKeyCache.Load(apiKey); ok {
		entry := val.(cacheEntry)
		if time.Since(entry.Timestamp) < CacheEntryDuration {
			return entry.Name, nil
		}
	}

	// If the key is not in the cache or the cache has expired, call the db to check the API key.
	name, err := db.CheckAPIKey(apiKey)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Warn().Msg("Authorization Failed for an API Key")
			return "", fmt.Errorf("AUTHFAILED")
		}
		return "", err
	}

	// The API key has been successfully authenticated, so cache it.
	db.ApiKeyCache.Store(apiKey, cacheEntry{Name: name, Timestamp: time.Now()})

	return name, nil
}
