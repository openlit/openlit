package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"ingester/config"
	"ingester/cost"
	"ingester/obsPlatform"
	"net/http"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"github.com/pkoukk/tiktoken-go"
	"github.com/rs/zerolog/log"
)

var (
	once     sync.Once      // once is used to ensure that the database is initialized only once
	db       *sql.DB        // db holds the database connection
	dbConfig DatabaseConfig // dbConfig holds the database configuration

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

// DBConfig holds the database configuration
type DatabaseConfig struct {
	DBName       string
	User         string
	Password     string
	Host         string
	Port         string
	SSLMode      string
	MaxIdleConns int
	MaxOpenConns int
}

// PingDB attempts to ping the database to check if it's alive.
func PingDB() error {
	var attempt int
	retryDelay := 15 * time.Second

	for attempt < 5 {
		attempt++
		err := db.Ping()
		if err == nil {
			log.Info().Msg("Successfully connected to the database")
			return nil
		}

		log.Warn().Err(err).Msgf("Failed to connect to the database on attempt %d, retrying in %s", attempt, retryDelay)
		time.Sleep(retryDelay)
	}

	return fmt.Errorf("Failed to connect to the database after %d attempts", attempt)
}

// GenerateSecureRandomKey should generate a secure random string to be used as an API key.
func generateSecureRandomKey() (string, error) {
	randomPartLength := 40 / 2 // Each byte becomes two hex characters, so we need half as many bytes.

	randomBytes := make([]byte, randomPartLength)
	_, err := rand.Read(randomBytes)
	if err != nil {
		log.Error().Err(err).Msg("Error generating random bytes")
		// In the case of an error, return it as we cannot generate a key.
		return "", err
	}

	// Encode the random bytes as a hex string and prefix with 'dk'.
	randomHexString := hex.EncodeToString(randomBytes)
	apiKey := "dk" + randomHexString

	return apiKey, nil
}

// getCreateAPIKeysTableSQL returns the SQL query to create the API keys table.
func getCreateAPIKeysTableSQL(tableName string) string {
	return fmt.Sprintf(`
	CREATE TABLE IF NOT EXISTS %s (
		id SERIAL PRIMARY KEY,
		api_key VARCHAR(255) NOT NULL UNIQUE,
		name VARCHAR(50) NOT NULL,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);`, tableName)
}

// getCreateDataTableSQL returns the SQL query to create the data table.
func getCreateDataTableSQL(tableName string) string {
	return fmt.Sprintf(`
	CREATE TABLE IF NOT EXISTS %s (
		time TIMESTAMPTZ NOT NULL,
		id UUID DEFAULT gen_random_uuid(),
		llmReqId VARCHAR(50),
		name VARCHAR(10) NOT NULL,
		environment VARCHAR(50) NOT NULL,
		endpoint VARCHAR(50) NOT NULL,
		sourceLanguage VARCHAR(50) NOT NULL,
		applicationName VARCHAR(50) NOT NULL,
		completionTokens INTEGER,
		promptTokens INTEGER,
		totalTokens INTEGER,
		finishReason VARCHAR(50),
		requestDuration DOUBLE PRECISION,
		usageCost DOUBLE PRECISION,
		model VARCHAR(50),
		prompt TEXT,
		response TEXT,
		imageSize TEXT,
		revisedPrompt TEXT,
		image TEXT,
		audioVoice TEXT,
		finetuneJobStatus TEXT
	);`, tableName)
}

// tableExists checks if a table exists in the database.
func tableExists(db *sql.DB, tableName string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1
			FROM   information_schema.tables 
			WHERE  table_schema = 'public'
			AND    lower(table_name) = lower($1)
		)
	`

	var exists bool
	err := db.QueryRow(query, tableName).Scan(&exists)
	if err != nil {
		return false, err
	}

	return exists, nil
}

// createTable creates a table in the database if it doesn't exist.
func createTable(db *sql.DB, tableName string, retentionPeriod string) error {
	var createTableSQL string
	if tableName == "DOKU_APIKEYS" {
		createTableSQL = getCreateAPIKeysTableSQL(tableName)
	} else if tableName == "DOKU_LLM_DATA" {
		createTableSQL = getCreateDataTableSQL(tableName)
	}

	exists, err := tableExists(db, tableName)
	if err != nil {
		return fmt.Errorf("Error checking table '%s' existence: %w", tableName, err)
	}
	if exists == false {
		_, err := db.Exec(createTableSQL)
		if err != nil {
			return fmt.Errorf("Error creating table %s: %w", tableName, err)
		}
		log.Info().Msgf("Table '%s' created in the database", tableName)

		if tableName == "DOKU_APIKEYS" {
			createIndexSQL := fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_api_key ON %s (api_key);", tableName)
			_, err = db.Exec(createIndexSQL)
			if err != nil {
				return fmt.Errorf("Error creating index on 'api_key' column: %w", err)
			}
			log.Info().Msgf("Index on 'api_key' column checked/created in table '%s'", tableName)
		}

		// If the table to create is the data table, convert it into a hypertable
		if tableName == "DOKU_LLM_DATA" {
			_, err := db.Exec("SELECT create_hypertable($1, 'time')", tableName)
			if err != nil {
				return fmt.Errorf("Error creating hypertable: %w", err)
			}
			log.Info().Msgf("Table '%s' converted to a Hypertable", tableName)
			query := fmt.Sprintf("SELECT add_retention_policy('%s', INTERVAL '%s')", tableName, retentionPeriod)
			_, err = db.Exec(query)
			if err != nil {
				return fmt.Errorf("Error adding data retention policy: %w", err)
			}
			log.Info().Msgf("Added data retention policy of '%s' to '%s' ", retentionPeriod, tableName)
		}
	} else {
		log.Info().Msgf("Table '%s' already exists in the database", tableName)
	}
	return nil
}

// initializeDB initializes connection to the database.
func initializeDB() error {
	var dbErr error
	once.Do(func() {
		connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			dbConfig.Host, dbConfig.Port, dbConfig.User, dbConfig.Password, dbConfig.DBName, dbConfig.SSLMode)

		if db, dbErr = sql.Open("postgres", connStr); dbErr != nil {
			log.Error().Err(dbErr).Msg("Error connecting to the database")
			return
		}

		dbErr = PingDB()
		if dbErr != nil {
			return
		}

		db.SetMaxOpenConns(dbConfig.MaxOpenConns)
		db.SetMaxIdleConns(dbConfig.MaxIdleConns)
	})
	return dbErr
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
	if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" {
		data["usageCost"], _ = cost.CalculateEmbeddingsCost(data["promptTokens"].(float64), data["model"].(string))
	} else if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "cohere.generate" {
		if data["completionTokens"] != nil && data["promptTokens"] != nil {
			data["usageCost"], _ = cost.CalculateChatCost(data["promptTokens"].(float64), data["completionTokens"].(float64), data["model"].(string))
		} else if (data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions") && data["prompt"] != nil && data["response"] != nil {
			data["promptTokens"] = getTokens(data["prompt"].(string), data["model"].(string))
			data["completionTokens"] = getTokens(data["response"].(string), data["model"].(string))
			data["totalTokens"] = data["promptTokens"].(int) + data["completionTokens"].(int)
			data["usageCost"], _ = cost.CalculateChatCost(float64(data["promptTokens"].(int)), float64(data["completionTokens"].(int)), data["model"].(string))
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" {
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

	go obsPlatform.SendToPlatform(data)

	// Define the SQL query for data insertion
	query := fmt.Sprintf("INSERT INTO %s (time, llmReqId, name, environment, endpoint, sourceLanguage, applicationName, completionTokens, promptTokens, totalTokens, finishReason, requestDuration, usageCost, model, prompt, response, imageSize, revisedPrompt, image, audioVoice, finetuneJobStatus) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)", "DOKU_LLM_DATA")

	// Execute the SQL query
	_, err := db.Exec(query,
		data["name"],
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
	)
	if err != nil {
		log.Error().Err(err).Msg("Error Inserting data into the database")
		// Update the response message and status code for error
		return "Internal Server Error", http.StatusInternalServerError
	}

	return "Data insertion completed", http.StatusCreated
}

// Init initializes the database connection and creates the required tables.
func Init(cfg config.Configuration) error {

	// Initialize the database configuration
	dbConfig = DatabaseConfig{
		DBName:       cfg.DBConfig.DBName,
		User:         cfg.DBConfig.DBUser,
		Password:     cfg.DBConfig.DBPassword,
		Host:         cfg.DBConfig.DBHost,
		Port:         cfg.DBConfig.DBPort,
		SSLMode:      cfg.DBConfig.DBSSLMode,
		MaxIdleConns: cfg.DBConfig.MaxIdleConns,
		MaxOpenConns: cfg.DBConfig.MaxOpenConns,
	}

	err := initializeDB()
	if err != nil {
		log.Error().Err(err).Msg("Error initializing database")
		return fmt.Errorf("Could not initialize connection to the database: %w", err)
	}

	// Create the DATA and API keys table if it doesn't exist.
	log.Info().Msgf("Creating '%s' and '%s' tables in the database if they don't exist", "DOKU_APIKEYS", "DOKU_LLM_DATA")

	err = createTable(db, "DOKU_APIKEYS", cfg.RentionPeriod)
	if err != nil {
		log.Error().Err(err).Msgf("Error creating table %s", "DOKU_APIKEYS")
		return err
	}

	err = createTable(db, "DOKU_LLM_DATA", cfg.RentionPeriod)
	if err != nil {
		log.Error().Err(err).Msgf("Error creating table %s", "DOKU_APIKEYS")
		return err
	}
	return nil
}

// PerformDatabaseInsertion performs the database insertion synchronously.
func PerformDatabaseInsertion(data map[string]interface{}) (string, int) {
	// Call insertDataToDB directly instead of starting a new goroutine.
	responseMessage, statusCode := insertDataToDB(data)

	// The operation is now synchronous. Once insertDataToDB returns, the result is ready to use.
	return responseMessage, statusCode
}

// CheckAPIKey retrieves the name associated with the given API key from the database.
func CheckAPIKey(apiKey string) (string, error) {
	var name string

	query := fmt.Sprintf("SELECT name FROM %s WHERE api_key = $1", "DOKU_APIKEYS")
	err := db.QueryRow(query, apiKey).Scan(&name)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", err
		}
		return "", err
	}
	return name, nil
}

// GenerateAPIKey generates a new API key for a given name and stores it in the database.
func GenerateAPIKey(existingAPIKey, name string) (string, error) {
	// If there are any existing API keys, authenticate the provided API key before proceeding
	var count int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s", "DOKU_APIKEYS")
	err := db.QueryRow(countQuery).Scan(&count)
	if err != nil {
		log.Error().Err(err).Msg("Error checking API key table")
		return "", fmt.Errorf("Failed to check API key table: %v", err)
	}

	// Only perform the check if the count is greater than zero
	if count > 0 {
		// Attempt to retrieve any existing key for the given name.
		_, err = GetAPIKeyForName(existingAPIKey, name)
		if err == nil {
			log.Warn().Msgf("Error creating new API Key as a key with the name '%s' already exists", name)
			return "", fmt.Errorf("KEYEXISTS")
		} else if err.Error() == "AUTHFAILED" {
			return "", err
		}
	}

	// No existing key found, proceed to generate a new API key
	log.Info().Msgf("Creating a new API Key with the name: %s", name)
	newAPIKey, _ := generateSecureRandomKey()

	// Insert the new API key into the database
	insertQuery := fmt.Sprintf("INSERT INTO %s (api_key, name) VALUES ($1, $2)", "DOKU_APIKEYS")
	_, err = db.Exec(insertQuery, newAPIKey, name)
	if err != nil {
		log.Error().Err(err).Msg("Error inserting the new API key in the database")
		return "", err
	}
	log.Info().Msgf("API Key with the name '%s' created successfully", name)
	return newAPIKey, nil
}

// GetAPIKeyForName retrieves an API key for a given name from the database.
func GetAPIKeyForName(existingAPIKey, name string) (string, error) {

	// Autheticate the provided API key before proceeding
	_, err := CheckAPIKey(existingAPIKey)
	if err != nil {
		log.Warn().Msg("Authorization Failed for an API Key")
		return "", fmt.Errorf("AUTHFAILED")
	}

	// Retrieve the API key for the given name
	var apiKey string
	query := fmt.Sprintf("SELECT api_key FROM %s WHERE name = $1", "DOKU_APIKEYS")
	err = db.QueryRow(query, name).Scan(&apiKey)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Warn().Msgf("API Key with the name '%s' currently not found in the database", name)
			return "", fmt.Errorf("NOTFOUND")
		}
		log.Warn().Err(err).Msgf("Error retrieving API key for the name '%s'", name)
		return "", err
	}

	return apiKey, nil
}

// DeleteAPIKey deletes an API key for a given name from the database.
func DeleteAPIKey(existingAPIKey, name string) error {

	// Autheticate the provided API key before proceeding and check if the API key exists
	apiKey, err := GetAPIKeyForName(existingAPIKey, name)
	if err != nil {
		if err.Error() == "AUTHFAILED" {
			return err
		}
		if err.Error() == "NOTFOUND" {
			return err
		}
		return err
	}

	// Delete the API key from the database
	log.Info().Msgf("Deleting API Key with the name '%s' from the database", name)
	query := fmt.Sprintf("DELETE FROM %s WHERE api_key = $1", "DOKU_APIKEYS")
	_, err = db.Exec(query, apiKey)
	if err != nil {
		log.Error().Err(err).Msg("Error deleting API key")
		return err
	}
	log.Info().Msgf("API Key with the name '%s' deleted successfully", name)
	return nil
}
