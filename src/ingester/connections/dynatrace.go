package connections

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
)

func configureDynatraceData(data map[string]interface{}, config ConnectionConfig) {
	dynatraceMetricsUrl := config.MetricsUrl
	dynatraceLogsUrl := config.LogsUrl
	dynatraceAPIKey := config.ApiKey

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

		// Building the data string by concatenating sprintf calls for each metric
		metrics := fmt.Sprintf(`doku.llm.total.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",finish_reason="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["totalTokens"]) + "\n" +
			fmt.Sprintf(`doku.llm.completion.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",finish_reason="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["completionTokens"]) + "\n" +
			fmt.Sprintf(`doku.llm.prompt.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",finish_reason="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["promptTokens"]) + "\n" +
			fmt.Sprintf(`doku.llm.usage.cost,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",finish_reason="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["usageCost"]) + "\n" +
			fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",finish_reason="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["requestDuration"])

		err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
		}

		logEntries := []string{
			fmt.Sprintf(`{
				"body": "%s",
				"environment": "%v",
				"endpoint": "%v",
				"application": "%v",
				"source": "%v",
				"model": "%v",
				"generation": "%v",
				"platform": "%v",
				"type": "prompt",
				"cost": %v,
				"job": "doku"
			}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
			fmt.Sprintf(`{
				"body": "%s",
				"environment": "%v",
				"endpoint": "%v",
				"application": "%v",
				"source": "%v",
				"model": "%v",
				"generation": "%v",
				"platform": "%v",
				"type": "response",
				"cost": %v,
				"job": "doku"
			}`, normalizeString(data["response"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
		}

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDynatrace(logs, dynatraceAPIKey, dynatraceLogsUrl, "application/json", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" || data["endpoint"] == "mistral.embeddings" || data["endpoint"] == "azure.embeddings" {
		if data["endpoint"] == "openai.embeddings" {
			// Building the data string by concatenating sprintf calls for each metric
			metrics := fmt.Sprintf(`doku.llm.total.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["totalTokens"]) + "\n" +
				fmt.Sprintf(`doku.llm.prompt.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["promptTokens"]) + "\n" +
				fmt.Sprintf(`doku.llm.usage.cost,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"]) + "\n" +
				fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"])

			err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
			}

			logEntries := []string{
				fmt.Sprintf(`{
					"body": "%s",
					"environment": "%v",
					"endpoint": "%v",
					"application": "%v",
					"source": "%v",
					"model": "%v",
					"generation": "%v",
					"platform": "%v",
					"type": "prompt",
					"cost": %v,
					"job": "doku"
				}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
			}

			logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
			err = sendTelemetryDynatrace(logs, dynatraceAPIKey, dynatraceLogsUrl, "application/json", "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to DataDog")
			}
		} else {
			// Building the data string by concatenating sprintf calls for each metric
			metrics := fmt.Sprintf(`doku.llm.prompt.tokens,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["promptTokens"]) + "\n" +
				fmt.Sprintf(`doku.llm.usage.cost,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"]) + "\n" +
				fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"])

			err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
			}

			logEntries := []string{
				fmt.Sprintf(`{
					"body": "%s",
					"environment": "%v",
					"endpoint": "%v",
					"application": "%v",
					"source": "%v",
					"model": "%v",
					"generation": "%v",
					"platform": "%v",
					"type": "prompt",
					"cost": %v,
					"job": "doku"
				}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
			}

			logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
			err = sendTelemetryDynatrace(logs, dynatraceAPIKey, dynatraceLogsUrl, "application/json", "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to DataDog")
			}
		}
	} else if data["endpoint"] == "openai.fine_tuning" {
		// Building the data string by concatenating sprintf calls for each metric
		metrics := fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"])

		err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" || data["endpoint"] == "azure.images.create" {
		// Building the data string by concatenating sprintf calls for each metric
		metrics := fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"]) + "\n" +
			fmt.Sprintf(`doku.llm.usage.cost,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"])

		err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
		}

		var logEntries []string
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
			logEntries = append(logEntries, fmt.Sprintf(`{
				"body": "%s",
				"environment": "%v",
				"endpoint": "%v",
				"application": "%v",
				"source": "%v",
				"model": "%v",
				"generation": "%v",
				"platform": "%v",
				"type": "prompt",
				"cost": %v,
				"job": "doku"
			}`, promptMessage, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
			)
		}

		logEntries = append(logEntries, fmt.Sprintf(`{
			"body": "%s",
			"environment": "%v",
			"endpoint": "%v",
			"application": "%v",
			"source": "%v",
			"model": "%v",
			"generation": "%v",
			"platform": "%v",
			"type": "image",
			"cost": %v,
			"job": "doku"
		}`, data["image"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], call_type, platform, data["usageCost"]),
		)

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDynatrace(logs, dynatraceAPIKey, dynatraceLogsUrl, "application/json", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	} else if data["endpoint"] == "openai.audio.speech.create" {
		// Building the data string by concatenating sprintf calls for each metric
		metrics := fmt.Sprintf(`doku.llm.request.duration,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"]) + "\n" +
			fmt.Sprintf(`doku.llm.usage.cost,environment="%v",endpoint="%v",application="%v",source="%v",model="%v",platform="%v",generation="%v",job="doku" %v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"])

		err := sendTelemetryDynatrace(metrics, dynatraceAPIKey, dynatraceMetricsUrl, "text/plain", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to Dynatrace")
		}

		logEntries := []string{
			fmt.Sprintf(`{
				"body": "%s",
				"environment": "%v",
				"endpoint": "%v",
				"application": "%v",
				"source": "%v",
				"audioVoice": "%v",
				"model": "%v",
				"generation": "%v",
				"platform": "%v",
				"type": "prompt",
				"cost": %v,
				"job": "doku"
			}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["audioVoice"], data["model"], call_type, platform, data["usageCost"]),
		}

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDynatrace(logs, dynatraceAPIKey, dynatraceLogsUrl, "application/json", "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	}
}

func sendTelemetryDynatrace(telemetryData, apiKey string, url string, contentType string, requestType string) error {
	// Create a new request using http
	req, err := http.NewRequest(requestType, url, bytes.NewBuffer([]byte(telemetryData)))
	if err != nil {
		return fmt.Errorf("error creating request")
	}

	// Add headers to the request
	req.Header.Add("Authorization", "Api-Token "+apiKey)
	req.Header.Add("Content-Type", contentType)

	// Send the request via a client
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request to %v", url)
	}

	defer resp.Body.Close()

	// Optionally, read the response body
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		// Handle error
		panic(err)
	}

	// Printing the response body for demonstration purposes
	println(string(responseBody))
	return nil
}
