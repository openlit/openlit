package obsPlatform

import (
	"bytes"
	"fmt"
	"ingester/config"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

var (
	ObservabilityPlatform string       // ObservabilityPlatform contains the information on the platform in use.
	httpClient            *http.Client // httpClient is the HTTP client used to send data to the Observability Platform.
	grafanaPromUrl        string       // grafanaPrometheusUrl is the URL used to send data to Grafana Prometheus.
	grafanaPromUsername   string       // grafanaPrometheusUsername is the username used to send data to Grafana Prometheus.
	grafanaLokiUrl        string       // grafanaPostUrl is the URL used to send data to Grafana Loki.
	grafanaLokiUsername   string       // grafanaLokiUsername is the username used to send data to Grafana Loki.
	grafanaAccessToken    string       // grafanaAccessToken is the access token used to send data to Grafana.
	newRelicLicenseKey    string       // newRelicKey is the key used to send data to New Relic.
	newRelicMetricsUrl    string       // newRelicMetricsUrl is the URL used to send data to New Relic.
	newRelicLogsUrl       string       // newRelicLogsUrl is the URL used to send logs to New Relic.
	dataDogMetricsUrl     string       // dataDogMetricsUrl is the URL used to send data to DataDog.
	dataDogLogsUrl        string       // dataDogLogsUrl is the URL used to send logs to DataDog.
	dataDogAPIKey         string       // dataDogAPIKey is the API key used to send data to DataDog.
)

func normalizeString(s string) string {
	// Remove backslashes
	s = strings.ReplaceAll(s, `\`, "")

	// Replace double quotes with single quotes
	s = strings.ReplaceAll(s, `"`, "'")

	// Normalize spacing around hyphens: no space before, one space after hyphens
	s = strings.ReplaceAll(s, " - ", " -")
	s = strings.ReplaceAll(s, " -", " -")
	s = strings.ReplaceAll(s, "- ", " - ")

	// Collapse multiple spaces into a single space
	re := regexp.MustCompile(`\s+`)
	s = re.ReplaceAllString(s, " ")

	// Trim leading and trailing whitespace
	s = strings.TrimSpace(s)

	return s
}

func Init(cfg config.Configuration) error {
	httpClient = &http.Client{Timeout: 5 * time.Second}
	if cfg.ObservabilityPlatform.GrafanaCloud.LokiURL != "" {
		grafanaPromUrl = cfg.ObservabilityPlatform.GrafanaCloud.PromURL
		grafanaPromUsername = cfg.ObservabilityPlatform.GrafanaCloud.PromUsername
		grafanaLokiUrl = cfg.ObservabilityPlatform.GrafanaCloud.LokiURL
		grafanaLokiUsername = cfg.ObservabilityPlatform.GrafanaCloud.LokiUsername
		grafanaAccessToken = cfg.ObservabilityPlatform.GrafanaCloud.AccessToken
	} else if cfg.ObservabilityPlatform.NewRelic.Key != "" {
		newRelicLicenseKey = cfg.ObservabilityPlatform.NewRelic.Key
		newRelicMetricsUrl = cfg.ObservabilityPlatform.NewRelic.MetricsURL
		newRelicLogsUrl = cfg.ObservabilityPlatform.NewRelic.LogsURL
	} else if cfg.ObservabilityPlatform.DataDog.APIKey != "" {
		dataDogMetricsUrl = cfg.ObservabilityPlatform.DataDog.MetricsURL
		dataDogLogsUrl = cfg.ObservabilityPlatform.DataDog.LogsURL
		dataDogAPIKey = cfg.ObservabilityPlatform.DataDog.APIKey
	}
	return nil
}

// SendToPlatform sends observability data to the appropriate platform.
func SendToPlatform(data map[string]interface{}) {
	if grafanaLokiUrl != "" {
		if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.generate" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "anthropic.completions" {
			if data["finishReason"] == nil {
				data["finishReason"] = "null"
			}
			metrics := []string{
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v completionTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], data["completionTokens"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], data["promptTokens"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v totalTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], data["totalTokens"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], data["requestDuration"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], data["usageCost"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}

			authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)

			response_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"response\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), normalizeString(data["response"].(string))))
			err = sendTelemetry(response_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}

			prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), normalizeString(data["prompt"].(string))))
			err = sendTelemetry(prompt_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" {
			if data["endpoint"] == "openai.embeddings" {
				metrics := []string{
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["promptTokens"]),
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v totalTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["totalTokens"]),
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["requestDuration"]),
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["usageCost"]),
				}
				var metricsBody = []byte(strings.Join(metrics, "\n"))
				authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
				err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
				if err != nil {
					log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
				}

				authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
				prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["prompt"]))
				err = sendTelemetry(prompt_log, authHeader, grafanaLokiUrl, "POST")
				if err != nil {
					log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
				}
			} else {
				metrics := []string{
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["promptTokens"]),
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["requestDuration"]),
					fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["usageCost"]),
				}
				var metricsBody = []byte(strings.Join(metrics, "\n"))
				authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
				err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
				if err != nil {
					log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
				}

				authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
				prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["prompt"]))
				err = sendTelemetry(prompt_log, authHeader, grafanaLokiUrl, "POST")
				if err != nil {
					log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
				}
			}
		} else if data["endpoint"] == "openai.fine_tuning" {
			metrics := []string{
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finetuneJobId=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finetuneJobId"], data["requestDuration"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}
		} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" {
			metrics := []string{
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,imageSize=%v,imageQuality=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], data["requestDuration"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,imageSize=%v,imageQuality=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], data["usageCost"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}

			authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
			if data["endpoint"] != "openai.images.create.variations" {
				prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["revisedPrompt"]))
				if data["model"] == "dall-e-2" {
					prompt_log = []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["prompt"]))
				}
				err = sendTelemetry(prompt_log, authHeader, grafanaLokiUrl, "POST")
				if err != nil {
					log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
				}
			}
			image_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"image\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["image"]))
			err = sendTelemetry(image_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		} else if data["endpoint"] == "openai.audio.speech.create" {
			metrics := []string{
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,audioVoice=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], data["requestDuration"]),
				fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,audioVoice=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], data["usageCost"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetry(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}

			authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
			prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"type\": \"prompt\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], strconv.FormatInt(time.Now().UnixNano(), 10), data["prompt"]))
			err = sendTelemetry(prompt_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		}
	} else if newRelicMetricsUrl != "" {
		configureNewRelicData(data)
	} else if dataDogMetricsUrl != "" {
		configureDataDogData(data)
	} else {
		log.Info().Msg("No Observability Platform configured")
	}
}

func sendTelemetry(telemetryData []byte, authHeader string, url string, requestType string) error {

	req, err := http.NewRequest(requestType, url, bytes.NewBuffer(telemetryData))
	if err != nil {
		return fmt.Errorf("Error creating request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("Error sending request to %v", url)
	} else if resp.StatusCode == 404 {
		return fmt.Errorf("Provided URL %v is not valid", url)
	} else if resp.StatusCode == 401 {
		return fmt.Errorf("Provided credentials are not valid")
	}

	defer resp.Body.Close()

	log.Info().Msgf("Successfully exported data to %v", url)
	return nil
}
