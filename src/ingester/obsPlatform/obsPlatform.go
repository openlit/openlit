package obsPlatform

import (
	"ingester/config"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

var (
	ObservabilityPlatform string       // ObservabilityPlatform contains the information on the platform in use.
	httpClient            *http.Client // httpClient is the HTTP client used to send data to the Observability Platform.
	platform, call_type   string       // platform is the platform used to send data to the Observability Platform.
	endpointTypeMapping   = map[string]string{
		"openai.chat.completions":         "Chat",
		"openai.completions":              "Chat",
		"cohere.generate":                 "Chat",
		"cohere.chat":                     "Chat",
		"cohere.summarize":                "Chat",
		"anthropic.completions":           "Chat",
		"openai.embeddings":               "Embeddings",
		"cohere.embed":                    "Embeddings",
		"openai.images.create":            "Image",
		"openai.images.create.variations": "Image",
		"openai.audio.speech.create":      "Audio",
		"openai.fine_tuning":              "FineTuning",
	}
	grafanaPromUrl      string // grafanaPrometheusUrl is the URL used to send data to Grafana Prometheus.
	grafanaPromUsername string // grafanaPrometheusUsername is the username used to send data to Grafana Prometheus.
	grafanaLokiUrl      string // grafanaPostUrl is the URL used to send data to Grafana Loki.
	grafanaLokiUsername string // grafanaLokiUsername is the username used to send data to Grafana Loki.
	grafanaAccessToken  string // grafanaAccessToken is the access token used to send data to Grafana.
	newRelicLicenseKey  string // newRelicKey is the key used to send data to New Relic.
	newRelicMetricsUrl  string // newRelicMetricsUrl is the URL used to send data to New Relic.
	newRelicLogsUrl     string // newRelicLogsUrl is the URL used to send logs to New Relic.
	dataDogMetricsUrl   string // dataDogMetricsUrl is the URL used to send data to DataDog.
	dataDogLogsUrl      string // dataDogLogsUrl is the URL used to send logs to DataDog.
	dataDogAPIKey       string // dataDogAPIKey is the API key used to send data to DataDog.
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
		configureGrafanaCloudData(data)
	} else if newRelicMetricsUrl != "" {
		configureNewRelicData(data)
	} else if dataDogMetricsUrl != "" {
		configureDataDogData(data)
	} else {
		log.Info().Msg("No Observability Platform configured")
	}
}
