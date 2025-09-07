{{/*
Expand the name of the chart.
*/}}
{{- define "openlit-operator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "openlit-operator.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "openlit-operator.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "openlit-operator.labels" -}}
helm.sh/chart: {{ include "openlit-operator.chart" . }}
{{ include "openlit-operator.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "openlit-operator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openlit-operator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "openlit-operator.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "openlit-operator.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the cluster role to use
*/}}
{{- define "openlit-operator.clusterRoleName" -}}
{{- default (include "openlit-operator.fullname" .) .Values.rbac.clusterRoleName }}
{{- end }}

{{/*
Create the name of the cluster role binding to use
*/}}
{{- define "openlit-operator.clusterRoleBindingName" -}}
{{- default (include "openlit-operator.fullname" .) .Values.rbac.clusterRoleBindingName }}
{{- end }}

{{/*
Create the name of the webhook service to use
*/}}
{{- define "openlit-operator.webhookServiceName" -}}
{{- if .Values.webhook.service.name }}
{{- .Values.webhook.service.name }}
{{- else }}
{{- printf "%s-webhook-service" (include "openlit-operator.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Create the name of the webhook configuration to use
*/}}
{{- define "openlit-operator.webhookConfigName" -}}
{{- if .Values.webhook.configName }}
{{- .Values.webhook.configName }}
{{- else }}
{{- printf "%s-mutating-webhook-configuration" (include "openlit-operator.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Create the name of the TLS secret to use
*/}}
{{- define "openlit-operator.tlsSecretName" -}}
{{- if .Values.tls.secretName }}
{{- .Values.tls.secretName }}
{{- else }}
{{- printf "%s-webhook-server-certs" (include "openlit-operator.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Create the namespace to use
*/}}
{{- define "openlit-operator.namespace" -}}
{{- if .Values.global.namespace }}
{{- .Values.global.namespace }}
{{- else }}
{{- .Release.Namespace }}
{{- end }}
{{- end }}

{{/*
Create the image name for the operator
*/}}
{{- define "openlit-operator.image" -}}
{{- if .Values.image.tag }}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository .Chart.AppVersion }}
{{- end }}
{{- end }}

{{/*
Create the default init image environment variable value (uses default provider)
*/}}
{{- define "openlit-operator.defaultInitImage" -}}
{{- if .Values.operator.defaultInitImage }}
{{- .Values.operator.defaultInitImage }}
{{- else }}
{{/* Use the default provider image (openlit) */}}
{{- include "openlit-operator.providerImage" (dict "provider" .Values.instrumentation.defaultProvider "Values" .Values "Chart" .Chart) }}
{{- end }}
{{- end }}

{{/*
Get provider-specific init image with version fallback logic
*/}}
{{- define "openlit-operator.providerImage" -}}
{{- $provider := .provider -}}
{{- $providerConfig := index $.Values.providerImages $provider -}}
{{- if $providerConfig }}
{{- $tag := $providerConfig.tag -}}
{{- if not $tag }}
{{/* Use operator image tag as fallback */}}
{{- if $.Values.image.tag }}
{{- $tag = $.Values.image.tag }}
{{- else }}
{{- $tag = $.Chart.AppVersion }}
{{- end }}
{{- end }}
{{- printf "%s:%s" $providerConfig.repository $tag }}
{{- else }}
{{/* Fallback to default provider image */}}
{{- $defaultProvider := $.Values.instrumentation.defaultProvider -}}
{{- $defaultConfig := index $.Values.providerImages $defaultProvider -}}
{{- if $defaultConfig }}
{{- $defaultTag := $defaultConfig.tag -}}
{{- if not $defaultTag }}
{{- if $.Values.image.tag }}
{{- $defaultTag = $.Values.image.tag }}
{{- else }}
{{- $defaultTag = $.Chart.AppVersion }}
{{- end }}
{{- end }}
{{- printf "%s:%s" $defaultConfig.repository $defaultTag }}
{{- else }}
{{- fail (printf "No configuration found for default provider: %s" $defaultProvider) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common annotations
*/}}
{{- define "openlit-operator.annotations" -}}
{{- with .Values.global.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Pod labels including common labels and pod-specific labels
*/}}
{{- define "openlit-operator.podLabels" -}}
{{ include "openlit-operator.selectorLabels" . }}
{{- with .Values.deployment.podLabels }}
{{ toYaml . }}
{{- end }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Pod annotations including common annotations and pod-specific annotations
*/}}
{{- define "openlit-operator.podAnnotations" -}}
{{- with .Values.deployment.podAnnotations }}
{{ toYaml . }}
{{- end }}
{{- with .Values.global.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create environment variables for the operator
*/}}
{{- define "openlit-operator.env" -}}
- name: OPENLIT_DEFAULT_INIT_IMAGE
  value: {{ include "openlit-operator.defaultInitImage" . | quote }}
- name: LOG_LEVEL
  value: {{ .Values.observability.logLevel | quote }}
- name: WEBHOOK_FAILURE_POLICY
  value: {{ .Values.webhook.failurePolicy | quote }}
- name: WEBHOOK_REINVOCATION_POLICY
  value: {{ .Values.webhook.reinvocationPolicy | quote }}
- name: WEBHOOK_PORT
  value: {{ .Values.webhook.server.port | quote }}
- name: WEBHOOK_PATH
  value: {{ .Values.webhook.server.path | quote }}
- name: WEBHOOK_CERT_DIR
  value: {{ .Values.webhook.server.certDir | quote }}
- name: WEBHOOK_SERVICE_NAME
  value: {{ include "openlit-operator.webhookServiceName" . | quote }}
- name: WEBHOOK_SECRET_NAME
  value: {{ include "openlit-operator.tlsSecretName" . | quote }}
- name: WEBHOOK_CONFIG_NAME
  value: {{ include "openlit-operator.webhookConfigName" . | quote }}
- name: CERT_VALIDITY_DAYS
  value: {{ .Values.tls.validityDays | quote }}
- name: CERT_REFRESH_DAYS
  value: {{ .Values.tls.refreshDays | quote }}
- name: HEALTH_PORT
  value: {{ .Values.healthcheck.port | quote }}
- name: SELF_MONITORING_ENABLED
  value: {{ .Values.observability.selfMonitoringEnabled | quote }}
{{- if .Values.observability.otel.endpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.observability.otel.endpoint | quote }}
{{- end }}
{{- if .Values.observability.otel.headers }}
- name: OTEL_EXPORTER_OTLP_HEADERS
  value: {{ .Values.observability.otel.headers | quote }}
{{- end }}
{{- if .Values.observability.otel.logsEndpoint }}
- name: OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
  value: {{ .Values.observability.otel.logsEndpoint | quote }}
{{- end }}
{{- if .Values.observability.otel.metricsEndpoint }}
- name: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
  value: {{ .Values.observability.otel.metricsEndpoint | quote }}
{{- end }}
{{- if .Values.multiOperator.watchNamespace }}
- name: WATCH_NAMESPACE
  value: {{ .Values.multiOperator.watchNamespace | quote }}
{{- end }}
{{- with .Values.env.extra }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create volume mounts for the operator
*/}}
{{- define "openlit-operator.volumeMounts" -}}
- mountPath: {{ .Values.webhook.server.certDir }}
  name: cert-dir
  readOnly: false
- mountPath: /tmp
  name: tmp
{{- with .Values.volumeMounts.extra }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create volumes for the operator
*/}}
{{- define "openlit-operator.volumes" -}}
- name: cert-dir
  emptyDir: {}
- name: tmp
  emptyDir: {}
{{- with .Values.volumes.extra }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Validate required values
*/}}
{{- define "openlit-operator.validateValues" -}}
{{- if not .Values.image.repository }}
{{- fail "image.repository is required" }}
{{- end }}
{{- if not .Values.providerImages.openlit.repository }}
{{- fail "providerImages.openlit.repository is required" }}
{{- end }}
{{- if not .Values.providerImages.openinference.repository }}
{{- fail "providerImages.openinference.repository is required" }}
{{- end }}
{{- if not .Values.providerImages.openllmetry.repository }}
{{- fail "providerImages.openllmetry.repository is required" }}
{{- end }}
{{- if not (has .Values.webhook.failurePolicy (list "Ignore" "Fail")) }}
{{- fail "webhook.failurePolicy must be either 'Ignore' or 'Fail'" }}
{{- end }}
{{- if not (has .Values.webhook.reinvocationPolicy (list "Never" "IfNeeded")) }}
{{- fail "webhook.reinvocationPolicy must be either 'Never' or 'IfNeeded'" }}
{{- end }}
{{- if not (has .Values.observability.logLevel (list "debug" "info" "warn" "error")) }}
{{- fail "observability.logLevel must be one of: debug, info, warn, error" }}
{{- end }}
{{- end }}
