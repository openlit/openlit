package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"ingester/auth"
	"ingester/db"

	"github.com/rs/zerolog/log"
)

const (
	// Constants for error messages
	errMsgKeyExists   = "An API Key with the name '%s' already exists"
	errMsgAuthFailed  = "Unauthorized: Please check your API Key and try again"
	errMsgKeyNotFound = "Unable to find API Key with the given name %s"
	errMsgInvalidBody = "Invalid request body"
)

// APIKeyRequest represents the expected request structure for API Key related endpoints.
type APIKeyRequest struct {
	Name string `json:"name"`
}

// jsonResponse represents the expected response structure for all endpoints.
type jsonResponse struct {
	Status  int         `json:"status"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Normalize capitalizes names fields in the request body.
func (r *APIKeyRequest) Normalize() {
	r.Name = strings.ToLower(r.Name)
}

// decodeRequestBody decodes the JSON request body into the destination struct.
func decodeRequestBody(r *http.Request, dest interface{}) error {
	return json.NewDecoder(r.Body).Decode(dest)
}

// getAuthKey retrieves the API Key from the request header.
func getAuthKey(r *http.Request) string {
	return r.Header.Get("Authorization")
}

// sendJSONResponse constructs and sends a JSON response with appropriate headers.
func sendJSONResponse(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	response := jsonResponse{
		Status:  status,
		Message: message,
	}

	json.NewEncoder(w).Encode(response)
}

// handleAPIKeyErrors centralizes the error handling logic for API Key operations.
func handleAPIKeyErrors(w http.ResponseWriter, err error, name string) {
	if err.Error() == "KEYEXISTS" {
		sendJSONResponse(w, http.StatusConflict, fmt.Sprintf(errMsgKeyExists, name))
		return
	} else if err.Error() == "AUTHFAILED" {
		sendJSONResponse(w, http.StatusUnauthorized, errMsgAuthFailed)
		return
	} else if err.Error() == "NOTFOUND" {
		sendJSONResponse(w, http.StatusNotFound, fmt.Sprintf(errMsgKeyNotFound, name))
		return
	} else {
		sendJSONResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
}

// generateAPIKeyHandler handles the creation of a new API Key
func generateAPIKeyHandler(w http.ResponseWriter, r *http.Request) {
	var request APIKeyRequest

	if err := decodeRequestBody(r, &request); err != nil {
		sendJSONResponse(w, http.StatusBadRequest, errMsgInvalidBody)
		return
	}
	request.Normalize()

	newAPIKey, err := db.GenerateAPIKey(getAuthKey(r), request.Name)
	if err != nil {
		handleAPIKeyErrors(w, err, request.Name)
		return
	}

	sendJSONResponse(w, http.StatusOK, newAPIKey)
}

// getAPIKeyHandler handles retrieving an existing API key.
func getAPIKeyHandler(w http.ResponseWriter, r *http.Request) {
	var request APIKeyRequest

	if err := decodeRequestBody(r, &request); err != nil {
		sendJSONResponse(w, http.StatusBadRequest, errMsgInvalidBody)
		return
	}
	request.Normalize()

	apiKey, err := db.GetAPIKeyForName(getAuthKey(r), request.Name)
	if err != nil {
		handleAPIKeyErrors(w, err, request.Name)
		return
	}

	sendJSONResponse(w, http.StatusOK, apiKey)
}

// deleteAPIKeyHandler handles deleting an existing API key.
func deleteAPIKeyHandler(w http.ResponseWriter, r *http.Request) {
	var request APIKeyRequest

	if err := decodeRequestBody(r, &request); err != nil {
		sendJSONResponse(w, http.StatusBadRequest, errMsgInvalidBody)
		return
	}

	request.Normalize()
	err := db.DeleteAPIKey(getAuthKey(r), request.Name)
	if err != nil {
		handleAPIKeyErrors(w, err, request.Name)
		return
	}

	sendJSONResponse(w, http.StatusOK, "API key deleted successfully")
}

// DataHandler handles data related operations recieved on `/api/push` endpoint.
func DataHandler(w http.ResponseWriter, r *http.Request) {
	var data map[string]interface{}

	if err := decodeRequestBody(r, &data); err != nil {
		sendJSONResponse(w, http.StatusBadRequest, errMsgInvalidBody)
		return
	}

	var err error
	data["name"], err = auth.AuthenticateRequest(getAuthKey(r))
	if err != nil {
		handleAPIKeyErrors(w, err, "")
		return
	}

	// Check if skipResp is true
	skipResp, ok := data["skipResp"].(bool)
	if ok && skipResp == true {
		sendJSONResponse(w, http.StatusAccepted, "Insertion started in background")
		go db.PerformDatabaseInsertion(data) // Running as a goroutine for async processing
		return
	}

	responseMessage, statusCode := db.PerformDatabaseInsertion(data)

	// Respond to the user with the insertion status and any potential errors
	sendJSONResponse(w, statusCode, responseMessage)
}

// APIKeyHandler handles all API Key tasks recieved on `/api/keys` endpoint.
func APIKeyHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getAPIKeyHandler(w, r)
	case "POST":
		generateAPIKeyHandler(w, r)
	case "DELETE":
		deleteAPIKeyHandler(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// BaseEndpoint serves as a health check and entry point for the service.
func BaseEndpoint(w http.ResponseWriter, r *http.Request) {
	if err := db.PingDB(); err != nil {
		log.Error().Err(err).Msgf("Health check failed") // Log the error
		sendJSONResponse(w, http.StatusServiceUnavailable, "Database is currently not reachable from the server")
		return
	}
	// The database is up and reachable.
	sendJSONResponse(w, http.StatusOK, "Welcome to Doku Ingester - Service operational")
}
