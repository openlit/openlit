package connections

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

func configureNewRelicData(data map[string]interface{}, config ConnectionConfig) {
	newRelicLicenseKey := config.ApiKey
	newRelicMetricsUrl := config.MetricsUrl
	newRelicLogsUrl := config.LogsUrl

	// The current time for the timestamp field.
	currentTime := strconv.FormatInt(time.Now().Unix(), 10)
	var platform string

	// Extract the platform from the endpoint string
	endpointParts := strings.Split(data["endpoint"].(string), ".")
	if len(endpointParts) > 0 {
		platform = endpointParts[0] // The first part of the endpoint string is the platform.
	} else {
		platform = "Unknown" // If the endpoint string is not in the expected format, set the platform to "unknown".
	}

	// Determine the type based on the endpoint by consulting the mapping.
	call_type, found := endpointTypeMapping[data["endpoint"].(string)]
	if !found {
		call_type = "Unknown"
	}

	if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.generate" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "anthropic.messages" || data["endpoint"] == "mistral.chat" || data["endpoint"] == "azure.chat.completions" || data["endpoint"] == "azure.completions" {
		if data["finishReason"] == nil {
			data["finishReason"] = "null"
		}

		jsonMetrics := []string{
			fmt.Sprintf(`{
			"name": "doku.LLM.Completion.Tokens",
			"type": "gauge",
			"value": %f,
			"timestamp": %s,
			"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "finishReason": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
		}`, data["completionTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
			"name": "doku.LLM.Prompt.Tokens",
			"type": "gauge",
			"value": %f,
			"timestamp": %s,
			"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "finishReason": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
		}`, data["promptTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
			"name": "doku.LLM.Total.Tokens",
			"type": "gauge",
			"value": %f,
			"timestamp": %s,
			"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "finishReason": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
		}`, data["totalTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
			"name": "doku.LLM.Request.Duration",
			"type": "gauge",
			"value": %v,
			"timestamp": %s,
			"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "finishReason": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
		}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
			"name": "doku.LLM.Usage.Cost",
			"type": "gauge",
			"value": %v,
			"timestamp": %s,
			"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "finishReason": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
		}`, data["usageCost"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
		}

		// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
		jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

		err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to New Relic")
		}

		// Use the values from the provided log lines and adapt them to the desired format.
		logs := []string{
			fmt.Sprintf(`{
				"timestamp": %s,
				"message": "%s",
				"attributes": {
					"environment": "%v",
					"endpoint": "%v",
					"applicationName": "%v",
					"source": "%v",
					"model": "%v",
					"type": "response",
					"platform": "%v",
					"generation": "%v",
					"job.name": "doku"
				}
			}`, currentTime, normalizeString(data["response"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type), // Assuming 'response' is present in data and is a string.

			fmt.Sprintf(`{
				"timestamp": %s,
				"message": "%s",
				"attributes": {
					"environment": "%v",
					"endpoint": "%v",
					"applicationName": "%v",
					"source": "%v",
					"model": "%v",
					"type": "prompt",
					"platform": "%v",
					"generation": "%v",
					"job.name": "doku"
				}
			}`, currentTime, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type), // Assuming 'prompt' is present in data and is a string.
		}

		// Combine the individual log entries into a full JSON payload
		jsonData = fmt.Sprintf(`[{"logs": [%s]}]`, strings.Join(logs, ","))

		err = sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to New Relic")
		}

	} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" || data["endpoint"] == "mistral.embeddings" || data["endpoint"] == "azure.embeddings" {
		if data["endpoint"] == "openai.embeddings" {
			jsonMetrics := []string{
				fmt.Sprintf(`{
					"name": "doku.LLM.Prompt.Tokens",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": { "environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["promptTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"name": "doku.LLM.Total.Tokens",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["totalTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"name": "doku.LLM.Request.Duration",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": { "environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"name": "doku.LLM.Usage.Cost",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": { "environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["usageCost"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
			}

			// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
			jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

			err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Metrics to New Relic")
			}

			// Build log entries with varying labels
			logs := []string{
				fmt.Sprintf(`{
					"timestamp": %s,
					"message": "%s",
					"attributes": {
						"environment": "%v",
						"endpoint": "%v",
						"applicationName": "%v",
						"source": "%v",
						"model": "%v",
						"type": "prompt",
						"platform": "%v",
						"generation": "%v",
						"job.name": "doku"
					}
				}`, currentTime, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type), // Assuming 'prompt' is present in data and is a string.
			}
			// Combine the individual log entries into a full JSON payload
			jsonData = fmt.Sprintf(`[{"logs": [%s]}]`, strings.Join(logs, ","))

			err = sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicLogsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to New Relic")
			}
		} else {
			jsonMetrics := []string{
				fmt.Sprintf(`{
					"name": "doku.LLM.Prompt.Tokens",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["promptTokens"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"name": "doku.LLM.Request.Duration",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"name": "doku.LLM.Usage.Cost",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["usageCost"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
			}

			// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
			jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

			err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Merics to New Relic")
			}

			logs := []string{
				// Assuming 'prompt' exists and is a string in data
				fmt.Sprintf(`{
					"timestamp": "%s",
					"message": "%s",
					"attributes": {
						"environment": "%v",
						"endpoint": "%v",
						"applicationName": "%v",
						"source": "%v",
						"model": "%v",
						"type": "prompt",
						"platform": "%v",
						"generation": "%v",
						"job.name": "doku"
					}
				}`,
					currentTime,
					data["prompt"],
					data["environment"],
					data["endpoint"],
					data["applicationName"],
					data["sourceLanguage"],
					data["model"],
					platform,
					call_type),
			}

			// Combine the individual log entries into a full JSON payload
			jsonData = fmt.Sprintf(`[{"logs": [%s]}]`, strings.Join(logs, ","))

			err = sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicLogsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to New Relic")
			}

		}
	} else if data["endpoint"] == "openai.fine_tuning" {
		jsonMetrics := []string{
			fmt.Sprintf(`{
					"name": "doku.LLM.Request.Duration",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
		}
		// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
		jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

		err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to New Relic")
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" || data["endpoint"] == "azure.images.create" {
		jsonMetrics := []string{
			fmt.Sprintf(`{
					"name": "doku.LLM.Request.Duration",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {
						"environment": "%v",
						"endpoint": "%v",
						"applicationName": "%v",
						"source": "%v",
						"model": "%v",
						"imageSize": "%v",
						"imageQuality": "%v",
						"platform": "%v", 
						"generation": "%v",
						"job.name": "doku"
					}
				}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type),
			fmt.Sprintf(`{
					"name": "doku.LLM.Usage.Cost",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {
						"environment": "%v",
						"endpoint": "%v",
						"applicationName": "%v",
						"source": "%v",
						"model": "%v",
						"imageSize": "%v",
						"imageQuality": "%v",
						"platform": "%v", 
						"generation": "%v",
						"job.name": "doku"
					}
				}`, data["usageCost"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type),
		}

		// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
		jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

		err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to New Relic")
		}

		var logs []string
		// Check the condition for the prompt
		if data["endpoint"] != "openai.images.create.variations" {
			var promptMessage string
			if data["model"] == "dall-e-2" {
				// Assuming data["prompt"] exists and is a string
				promptMessage = normalizeString(data["prompt"].(string))
			} else {
				// Assuming data["revisedPrompt"] exists and is a string
				promptMessage = normalizeString(data["revisedPrompt"].(string))
			}

			// Build the prompt log
			logs = append(logs, fmt.Sprintf(`{
				"timestamp": "%s",
				"message": "%s",
				"attributes": {
					"environment": "%v",
					"endpoint": "%v",
					"applicationName": "%v",
					"source": "%v",
					"model": "%v",
					"type": "prompt",
					"platform": "%v",
					"generation": "%v",
					"job.name": "doku"
				}
			}`, currentTime, promptMessage, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type))
		}

		// Build the image log
		logs = append(logs, fmt.Sprintf(`{
			"timestamp": "%s",
			"message": "%s",
			"attributes": {
				"environment": "%v",
				"endpoint": "%v",
				"applicationName": "%v",
				"source": "%v",
				"model": "%v",
				"type": "image",
				"platform": "%v",
				"generation": "%v",
				"job.name": "doku"
			}
		}`, currentTime, data["image"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type))

		// Combine the individual log entries into a full JSON payload
		jsonData = fmt.Sprintf(`[{"logs": [%s]}]`, strings.Join(logs, ","))

		err = sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to New Relic")
		}

	} else if data["endpoint"] == "openai.audio.speech.create" {
		jsonMetrics := []string{
			fmt.Sprintf(`{
					"name": "doku_llm.RequestDuration",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "audioVoice": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["requestDuration"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type),
			fmt.Sprintf(`{
					"name": "doku_llm.UsageCost",
					"type": "gauge",
					"value": %v,
					"timestamp": %s,
					"attributes": {"environment": "%v", "endpoint": "%v", "applicationName": "%v", "source": "%v", "model": "%v", "audioVoice": "%v", "platform": "%v", "generation": "%v", "job.name": "doku"}
				}`, data["usageCost"], currentTime, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type),
		}

		// Join the individual metric strings into a comma-separated string and enclose in a JSON array.
		jsonData := fmt.Sprintf(`[{"metrics": [%s]}]`, strings.Join(jsonMetrics, ","))

		err := sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to New Relic")
		}

		logs := []string{
			// Assuming 'prompt' exists and is a string in data
			fmt.Sprintf(`{
				"timestamp": "%s",
				"message": "%s",
				"attributes": {
					"environment": "%v",
					"endpoint": "%v",
					"applicationName": "%v",
					"source": "%v",
					"model": "%v",
					"type": "prompt",
					"platform": "%v",
					"generation": "%v",
					"job.name": "doku"
				}
			}`, currentTime, data["prompt"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
		}

		// Combine the individual log entries into a full JSON payload
		jsonData = fmt.Sprintf(`[{"logs": [%s]}]`, strings.Join(logs, ","))

		err = sendTelemetryNewRelic(jsonData, newRelicLicenseKey, "Api-Key", newRelicLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to New Relic")
		}
	}
}

func sendTelemetryNewRelic(telemetryData, authHeader string, headerKey string, url string, requestType string) error {

	req, err := http.NewRequest(requestType, url, bytes.NewBufferString(telemetryData))
	if err != nil {
		return fmt.Errorf("error creating request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerKey, authHeader)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request to %v", url)
	} else if resp.StatusCode == 404 {
		return fmt.Errorf("provided URL %v is not valid", url)
	} else if resp.StatusCode == 403 {
		return fmt.Errorf("provided credentials are not valid")
	}

	defer resp.Body.Close()

	log.Info().Msgf("Successfully exported data to %v", url)
	return nil
}
