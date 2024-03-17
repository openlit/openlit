package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"ingester/config"
	"ingester/connections"
	"ingester/cost"
	"net/http"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	_ "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/pkoukk/tiktoken-go"
	"github.com/rs/zerolog/log"
)

var (
	connectionCache        sync.Map               // connectionCache stores the lookup of connection details
	ApiKeyCache            = sync.Map{}           // ApiKeyCache stores the lookup of API keys and organization IDs.
	CacheEntryDuration     = time.Minute * 10     // CacheEntryDuration defines how long an item should stay in the cache before being re-validated.
	db                     clickhouse.Conn        // db holds the database connection
	ctx                    = context.Background() // ctx is the context for the database connection
	doku_llm_data_table    = "DOKU_LLM_DATA"      // doku_llm_data_table holds the name of the data table
	doku_apikeys_table     = "DOKU_APIKEYS"       // doku_apikeys_table holds the name of the API keys table
	doku_connections_table = "DOKU_CONNECTIONS"   // doku_connections_table holds the name of the connections table
	// validFields represent the fields that are expected in the incoming data.
	validFields = []string{
		"name",
		"llmReqId",
		"environment",
		"endpoint",
		"sourceLanguage",
		"applicationName",
		"completionTokens",
		"promptTokens",
		"totalTokens",
		"finishReason",
		"requestDuration",
		"usageCost",
		"model",
		"prompt",
		"response",
		"imageSize",
		"revisedPrompt",
		"image",
		"audioVoice",
		"finetuneJobStatus",
	}
)

type ConnectionRequest struct {
	Platform        string `json:"platform"`
	MetricsUsername string `json:"metricsUsername,omitempty"`
	LogsUserName    string `json:"logsUserName,omitempty"`
	ApiKey          string `json:"apiKey"`
	MetricsURL      string `json:"metricsURL,omitempty"`
	LogsURL         string `json:"logsURL,omitempty"`
}

type connectionCacheEntry struct {
	Config    *connections.ConnectionConfig
	Timestamp time.Time
}

// PingDB checks if the database is responsive.
func PingDB() error {
	if err := db.Ping(ctx); err != nil {
		return err
	}
	return nil
}

// EvictExpiredEntries goes through the cache and evicts expired entries.
func EvictExpiredEntries() {
	now := time.Now()
	connectionCache.Range(func(key, value interface{}) bool {
		if entry, ok := value.(connectionCacheEntry); ok {
			if now.Sub(entry.Timestamp) >= CacheEntryDuration {
				connectionCache.Delete(key)
			}
		}
		return true
	})
}

// GenerateSecureRandomKey should generate a secure random string to be used as an API key.
func generateSecureRandomKey() (string, error) {
	randomPartLength := 40 / 2 // Each byte becomes two hex characters, so we need half as many bytes.

	randomBytes := make([]byte, randomPartLength)
	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Error().Err(err).Msg("error generating random bytes")
		// In the case of an error, return it as we cannot generate a key.
		return "", err
	}

	// Encode the random bytes as a hex string and prefix with 'dk'.
	randomHexString := hex.EncodeToString(randomBytes)
	apiKey := "dk" + randomHexString

	return apiKey, nil
}

// getCreateConnectionsTableSQL returns the SQL query to create the API keys table.
func getCreateConnectionsTableSQL(tableName string) string {
	return fmt.Sprintf(`
    CREATE TABLE IF NOT EXISTS %s (
        id UUID DEFAULT generateUUIDv4(), 
        platform String NOT NULL,
        metricsUrl String NOT NULL,
        logsUrl String NOT NULL,
        apiKey String NOT NULL,
        metricsUsername String NOT NULL,
        logsUsername String NOT NULL,
        created_at DateTime DEFAULT now() 
    ) ENGINE = MergeTree()
    ORDER BY id;`, tableName)
}

// getCreateAPIKeysTableSQL returns the SQL query to create the API keys table.
func getCreateAPIKeysTableSQL(tableName string) string {
	return fmt.Sprintf(`
    CREATE TABLE IF NOT EXISTS %s (
        id UUID DEFAULT generateUUIDv4(),  // Use ClickHouse's function to generate UUIDs
        api_key String NOT NULL,  // VARCHAR is equivalent to String in ClickHouse
        name String NOT NULL,
        created_at DateTime DEFAULT now()
    ) ENGINE = MergeTree()  // Specify the table engine, MergeTree engines are common in ClickHouse
    ORDER BY (id, api_key);`, tableName) // Define the primary key as part of the engine's ORDER BY
}

// getCreateDataTableSQL returns the SQL query to create the data table in ClickHouse.
func getCreateDataTableSQL(tableName string, retentionPeriod string) string {
	return fmt.Sprintf(`
    CREATE TABLE IF NOT EXISTS %s (
        time DateTime NOT NULL,
        id UUID DEFAULT generateUUIDv4(), 
        llmReqId String, 
        environment String NOT NULL,
        endpoint String NOT NULL,
        sourceLanguage String NOT NULL,
        applicationName String NOT NULL,
        completionTokens Int32, 
        promptTokens Int32,
        totalTokens Int32,
        finishReason String,
        requestDuration Float64, 
        usageCost Float64,
        model String,
        prompt String,
        response String,
        imageSize String, 
        revisedPrompt String,
        image String,
        audioVoice String,
        finetuneJobStatus String,
        feedback Int32
    ) ENGINE = MergeTree() 
    ORDER BY (time, id)
	TTL time + INTERVAL + %s DELETE; `, tableName, retentionPeriod)
}

func tableExists(tableName string, databaseName string) (bool, error) {
	query := `SELECT count() 
              FROM system.tables 
              WHERE database = ? AND name = ?`

	var count uint64
	if err := db.QueryRow(ctx, query, databaseName, tableName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

// createTable attempts to create a table in ClickHouse if it doesn't already exist.
func createTable(tableName string, cfg config.Configuration) error {
	var createTableSQL string

	if tableName == doku_apikeys_table {
		createTableSQL = getCreateAPIKeysTableSQL(tableName)
	} else if tableName == doku_llm_data_table {
		createTableSQL = getCreateDataTableSQL(tableName, cfg.Database.RetentionPeriod)
	} else if tableName == doku_connections_table {
		createTableSQL = getCreateConnectionsTableSQL(tableName)
	}

	exists, err := tableExists(tableName, cfg.Database.Name)
	if err != nil {
		return fmt.Errorf("error checking table '%s' existence: %w", tableName, err)
	}
	if !exists {
		if err = db.Exec(ctx, createTableSQL); err != nil {
			return fmt.Errorf("error creating table '%s': %w", tableName, err)
		}
		if tableName == doku_apikeys_table {
			newAPIKey, _ := generateSecureRandomKey()
			// Insert the new API key into the database
			insertQuery := fmt.Sprintf("INSERT INTO %s (api_key, name) VALUES ($1, $2)", doku_apikeys_table)
			err = db.Exec(ctx, insertQuery, newAPIKey, "doku-client-internal")
			if err != nil {
				log.Error().Err(err).Msg("Error inserting the new API key in the database")
				return err
			}
		}
		log.Printf("table '%s' created in the database", tableName)
		return nil
	}
	log.Info().Msgf("table '%s' exists in the database", tableName)
	return nil
}

// initializeDB initializes connection to the database.
func initializeDB(cfg config.Configuration) error {
	var err error
	addr := fmt.Sprintf("%s:%s", cfg.Database.Host, cfg.Database.Port)
	for attempt := 1; attempt <= 5; attempt++ {
		db, _ = clickhouse.Open(&clickhouse.Options{
			Addr: []string{addr},
			Auth: clickhouse.Auth{
				Database: cfg.Database.Name,
				Username: cfg.Database.User,
				Password: cfg.Database.Password,
			},
			MaxOpenConns: cfg.Database.MaxOpenConns,
			MaxIdleConns: cfg.Database.MaxIdleConns,
		})

		// Ping the database to check if it's connected.
		if err = PingDB(); err != nil {
			log.Warn().Msgf("failed to connect to the database on attempt %d, retrying in %s", attempt, 15*time.Second)
			if attempt < 5 {
				db.Close()
				time.Sleep(15 * time.Second)
				continue
			}
			return err
		}
	}
	return nil
}

func getTokens(text, model string) int {
	tkm, err := tiktoken.EncodingForModel(model)
	if err != nil {
		tkm, _ = tiktoken.GetEncoding("cl100k_base")
	}
	token := tkm.Encode(text, nil, nil)
	return len(token)
}

// insertDataToDB inserts data into the database.
func insertDataToDB(data map[string]interface{}) (string, int) {
	// Calculate usage cost based on the endpoint type
	if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" || data["endpoint"] == "azure.embeddings" || data["endpoint"] == "mistral.embeddings" {
		data["usageCost"], _ = cost.CalculateEmbeddingsCost(data["promptTokens"].(float64), data["model"].(string))
	} else if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "cohere.generate" || data["endpoint"] == "anthropic.messages" || data["endpoint"] == "mistral.chat" || data["endpoint"] == "azure.chat.completions" || data["endpoint"] == "azure.completions" {
		if data["completionTokens"] != nil && data["promptTokens"] != nil {
			data["usageCost"], _ = cost.CalculateChatCost(data["promptTokens"].(float64), data["completionTokens"].(float64), data["model"].(string))
		} else if (data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "azure.completions" || data["endpoint"] == "azure.chat.completions") && data["prompt"] != nil && data["response"] != nil {
			data["promptTokens"] = getTokens(data["prompt"].(string), data["model"].(string))
			data["completionTokens"] = getTokens(data["response"].(string), data["model"].(string))
			data["totalTokens"] = data["promptTokens"].(int) + data["completionTokens"].(int)
			data["usageCost"], _ = cost.CalculateChatCost(float64(data["promptTokens"].(int)), float64(data["completionTokens"].(int)), data["model"].(string))
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" || data["endpoint"] == "azure.images.create" {
		data["usageCost"], _ = cost.CalculateImageCost(data["model"].(string), data["imageSize"].(string), data["imageQuality"].(string))
	} else if data["endpoint"] == "openai.audio.speech.create" {
		data["usageCost"], _ = cost.CalculateAudioCost(data["prompt"].(string), data["model"].(string))
	}

	// Fill missing fields with nil
	for _, field := range validFields {
		if _, exists := data[field]; !exists {
			data[field] = nil
		}
	}

	// Construct query with placeholders
	query := fmt.Sprintf("INSERT INTO %s (time, llmReqId, environment, endpoint, sourceLanguage, applicationName, completionTokens, promptTokens, totalTokens, finishReason, requestDuration, usageCost, model, prompt, response, imageSize, revisedPrompt, image, audioVoice, finetuneJobStatus) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", doku_llm_data_table)

	// Create a slice for parameters in the correct order
	params := []interface{}{
		data["llmReqId"],
		data["environment"],
		data["endpoint"],
		data["sourceLanguage"],
		data["applicationName"],
		data["completionTokens"],
		data["promptTokens"],
		data["totalTokens"],
		data["finishReason"],
		data["requestDuration"],
		data["usageCost"],
		data["model"],
		data["prompt"],
		data["response"],
		data["imageSize"],
		data["revisedPrompt"],
		data["image"],
		data["audioVoice"],
		data["finetuneJobStatus"],
	}

	// Execute the SQL query
	err := db.Exec(ctx, query, params...)
	if err != nil {
		log.Error().Err(err).Msg("error Inserting data into the database")
		return "Internal Server Error", http.StatusInternalServerError
	}

	go func() {
		connDetails, err := checkConnections()
		if err != nil {
			log.Error().Err(err).Msg("Error checking for 'Connections' in the database")
		}

		if connDetails != nil {
			connections.SendToPlatform(data, *connDetails)
		} else {
			log.Info().Msg("No 'Connections' details found for export. skipping data export")
		}
	}()

	return "Data insertion completed", http.StatusCreated
}

// Init initializes the database connection and creates the required tables.
func Init(cfg config.Configuration) error {
	err := initializeDB(cfg)
	if err != nil {
		return err
	}

	// Create the DATA and API keys table if it doesn't exist.
	log.Info().Msgf("creating '%s', '%s' and '%s' tables in the database if they don't exist", doku_connections_table, doku_apikeys_table, doku_llm_data_table)

	err = createTable(doku_connections_table, cfg)
	if err != nil {
		return err
	}

	err = createTable(doku_apikeys_table, cfg)
	if err != nil {
		return err
	}

	err = createTable(doku_llm_data_table, cfg)
	if err != nil {
		return err
	}
	return nil
}

func checkConnections() (*connections.ConnectionConfig, error) {
	// Attempt to retrieve the connections config from cache first
	if value, ok := connectionCache.Load("connectionConfig"); ok {
		if entry, ok := value.(connectionCacheEntry); ok {
			// Check if the cache entry is still valid
			if time.Since(entry.Timestamp) < CacheEntryDuration {
				return entry.Config, nil
			}
		}
	}

	// If not in cache or cache is expired, query the database
	query := fmt.Sprintf("SELECT platform, metricsUrl, logsUrl, apiKey, metricsUsername, logsUsername FROM %s;", doku_connections_table)
	var connDetails connections.ConnectionConfig
	// Ensure you have a valid database connection 'db' to ClickHouse, and it might need a context passed if supported
	row := db.QueryRow(ctx, query) // Assuming you have a context 'ctx' available
	err := row.Scan(&connDetails.Platform, &connDetails.MetricsUrl, &connDetails.LogsUrl,
		&connDetails.ApiKey, &connDetails.MetricsUsername, &connDetails.LogsUsername)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	// Cache the newly retrieved ConnectionConfig
	connectionCache.Store("connectionConfig", connectionCacheEntry{Config: &connDetails, Timestamp: time.Now()})

	return &connDetails, nil
}

// PerformDatabaseInsertion performs the database insertion synchronously.
func PerformDatabaseInsertion(data map[string]interface{}) (string, int) {
	// Call insertDataToDB directly instead of starting a new goroutine.
	responseMessage, statusCode := insertDataToDB(data)

	// The operation is now synchronous. Once insertDataToDB returns, the result is ready to use.
	return responseMessage, statusCode
}

func CheckAPIKey(apiKey string) (string, error) {
	var name string

	// Adjust the placeholder for ClickHouse
	query := fmt.Sprintf("SELECT name FROM %s WHERE api_key = ?", doku_apikeys_table)
	err := db.QueryRow(ctx, query, apiKey).Scan(&name)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", err
		}
		return "", err
	}
	return name, nil
}

func GenerateAPIKey(existingAPIKey, name string) (string, error) {
	count := uint64(0)

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE name != 'doku-client-internal'", doku_apikeys_table)
	err := db.QueryRow(ctx, countQuery).Scan(&count)
	if err != nil {
		log.Error().Err(err).Msg("error checking API key table")
		return "", fmt.Errorf("failed to check API key table: %v", err)
	}

	// Only perform the check if the count is greater than zero
	if count > 0 {
		// Attempt to retrieve any existing key for the given name.
		_, err = GetAPIKeyForName(existingAPIKey, name)
		if err == nil {
			log.Warn().Msgf("error creating new API Key as a key with the name '%s' already exists", name)
			return "", fmt.Errorf("KEYEXISTS")
		} else if err.Error() == "AUTHFAILED" {
			return "", err
		}
	}

	newAPIKey, _ := generateSecureRandomKey()

	// Properly use placeholders for the query parameters, adjusted for ClickHouse
	insertQuery := fmt.Sprintf("INSERT INTO %s (api_key, name) VALUES (?, ?)", doku_apikeys_table)
	if err := db.Exec(ctx, insertQuery, newAPIKey, name); err != nil {
		log.Error().Err(err).Msg("error inserting the new API key in the database")
		return "", err
	}
	log.Info().Msgf("API Key with the name '%s' created successfully", name)
	return newAPIKey, nil
}

func GetAPIKeyForName(existingAPIKey, name string) (string, error) {
	// Authenticate the provided API key before proceeding
	_, err := CheckAPIKey(existingAPIKey)
	if err != nil {
		log.Warn().Msg("Authorization Failed for an API Key")
		return "", fmt.Errorf("AUTHFAILED")
	}
	// Retrieve the API key for the given name
	var apiKey string
	// Adjust the query to use ? as a placeholder
	query := fmt.Sprintf("SELECT api_key FROM %s WHERE name = ?", doku_apikeys_table)
	err = db.QueryRow(ctx, query, name).Scan(&apiKey)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Warn().Msgf("API Key with the name '%s' currently not found in the database", name)
			return "", fmt.Errorf("NOTFOUND")
		}
		log.Warn().Err(err).Msgf("error retrieving API key for the name '%s'", name)
		return "", err
	}

	return apiKey, nil
}

func DeleteAPIKey(existingAPIKey, name string) error {
	// Authenticate the provided API key before proceeding and check if the API key exists
	apiKey, err := GetAPIKeyForName(existingAPIKey, name)
	if err != nil {
		// If auth failed or API key was not found, return the error directly
		return err
	}

	// Delete the API key from the database
	log.Info().Msgf("deleting API Key with the name '%s' from the database", name)
	// Adjust the query to use ? as the placeholder for ClickHouse
	query := fmt.Sprintf("DELETE FROM %s WHERE api_key = ?", doku_apikeys_table)
	if err = db.Exec(ctx, query, apiKey); err != nil {
		log.Error().Err(err).Msg("error deleting API key")
		return err
	}

	// Assuming ApiKeyCache is a custom caching mechanism you've implemented
	ApiKeyCache.Delete(apiKey)
	log.Info().Msgf("API Key with the name '%s' deleted successfully", name)
	return nil
}

func GenerateConnection(existingAPIKey string, config ConnectionRequest) error {
	// Authenticate the provided API key before proceeding
	_, err := CheckAPIKey(existingAPIKey)
	if err != nil {
		log.Warn().Msg("Authorization Failed for an API Key")
		return fmt.Errorf("AUTHFAILED")
	}

	// Delete all existing rows in the connections table
	deleteRows := fmt.Sprintf("DELETE FROM %s WHERE 1=1", doku_connections_table)
	if err = db.Exec(ctx, deleteRows); err != nil {
		log.Error().Err(err).Msg("error deleting the existing Connections config in the database")
		return err
	}

	// Insert the new connection configuration into the table
	// Note: ClickHouse uses ? as placeholders
	insertQuery := fmt.Sprintf("INSERT INTO %s (platform, metricsUrl, logsUrl, apiKey, metricsUsername, logsUsername) VALUES (?, ?, ?, ?, ?, ?)", doku_connections_table)
	if err = db.Exec(ctx, insertQuery, config.Platform, config.MetricsURL, config.LogsURL, config.ApiKey, config.MetricsUsername, config.LogsUserName); err != nil {
		log.Error().Err(err).Msg("error inserting the new Connections config in the database")
		return err
	}
	// Assuming connectionCache is a custom mechanism for caching the connection configuration
	connectionCache.Delete("connectionConfig")
	log.Info().Msgf("New Connection config created successfully")
	return nil
}

// / DeleteConnection deletes the existing connection configuration from the database.
func DeleteConnection(existingAPIKey string) error {
	// Authenticate the provided API key before proceeding
	_, err := CheckAPIKey(existingAPIKey)
	if err != nil {
		log.Warn().Msg("Authorization Failed for an API Key")
		return fmt.Errorf("AUTHFAILED")
	}

	var count uint64
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s", doku_connections_table)
	err = db.QueryRow(ctx, countQuery).Scan(&count)
	if err != nil {
		log.Error().Err(err).Msg("error checking Connections Table")
		return fmt.Errorf("failed to check Connections table: %v", err)
	}
	if count >= 1 {
		deleteRows := fmt.Sprintf("DELETE FROM %s WHERE 1=1", doku_connections_table)
		err = db.Exec(ctx, deleteRows)
		if err != nil {
			log.Error().Err(err).Msg("error deleting the existing Connections config in the database")
			return err
		}
		// Assuming connectionCache is a mechanism you've implemented for caching
		connectionCache.Delete("connectionConfig")
		log.Info().Msg("connection config deleted successfully")
	} else {
		return fmt.Errorf("NOTFOUND")
	}

	return nil
}

// / GetConnection gets the existing connection configuration from the database.
func GetConnection(existingAPIKey string) (map[string]interface{}, error) {
	// Authenticate the provided API key before proceeding
	_, err := CheckAPIKey(existingAPIKey)
	if err != nil {
		log.Warn().Msg("Authorization Failed for an API Key")
		return nil, fmt.Errorf("AUTHFAILED")
	}

	connectionDetails := map[string]interface{}{}

	// Prepare the ClickHouse SQL query.
	query := fmt.Sprintf(`SELECT id, platform, metricsUrl, logsUrl, apiKey, metricsUsername, logsUsername, created_at FROM %s ORDER BY id LIMIT 1`, doku_connections_table)

	// QueryRow executes the query and returns at most one row.
	row := db.QueryRow(ctx, query)

	var id, platform, metricsUrl, logsUrl, apiKey, metricsUsername, logsUsername string
	var createdAt time.Time 

	// Scan the results into variables.
	err = row.Scan(&id, &platform, &metricsUrl, &logsUrl, &apiKey, &metricsUsername, &logsUsername, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Info().Msg("No configuration found in the database.")
			return nil, fmt.Errorf("NOTFOUND")
		}
		log.Error().Err(err).Msg("Failed to get the connection configuration")
		return nil, err
	}

	// Populate the results map.
	connectionDetails["id"] = id
	connectionDetails["platform"] = platform
	connectionDetails["metricsUrl"] = metricsUrl
	connectionDetails["logsUrl"] = logsUrl
	connectionDetails["apiKey"] = apiKey
	connectionDetails["metricsUsername"] = metricsUsername
	connectionDetails["logsUsername"] = logsUsername
	connectionDetails["created_at"] = createdAt

	return connectionDetails, nil
}
