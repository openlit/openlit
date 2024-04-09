import { CONNECTION_PLATFORM } from "@/helpers/connection";

export const CONNECTIONS = {
	grafana: {
		name: "Grafana",
		image: "/grafana.svg",
		platform: CONNECTION_PLATFORM.grafana,
	},
	datadog: {
		name: "Datadog",
		image: "/datadog.svg",
		platform: CONNECTION_PLATFORM.datadog,
	},
	newrelic: {
		name: "New Relic",
		image: "/newrelic.svg",
		platform: CONNECTION_PLATFORM.newrelic,
	},
	signoz: {
		name: "Signoz",
		image: "/signoz.svg",
		platform: CONNECTION_PLATFORM.signoz,
	},
	dynatrace: {
		name: "Dynatrace",
		image: "/dynatrace.svg",
		platform: CONNECTION_PLATFORM.dynatrace,
	},
};

const commonFormField = [
	{
		label: "API key",
		type: "text",
		name: "apiKey",
		placeholder: "Enter Api key",
	},
	{
		label: "Metrics Username",
		type: "text",
		name: "metricsUsername",
		placeholder: "Enter metrics username key",
	},
	{
		label: "Metrics URL",
		type: "text",
		name: "metricsUrl",
		placeholder: "Enter metrics url key",
	},
	{
		label: "Logs Username",
		type: "text",
		name: "logsUsername",
		placeholder: "Enter Logs username key",
	},
	{
		label: "Logs URL",
		type: "text",
		name: "logsUrl",
		placeholder: "Enter Logs url key",
	},
];

export const CONNECTIONS_FORM_FIELD = {
	grafana: commonFormField,
	datadog: commonFormField,
	newrelic: commonFormField,
	dynatrace: commonFormField,
	signoz: [
		{
			label: "API key",
			type: "text",
			name: "apiKey",
			placeholder: "Enter Api key",
		},
		{
			label: "Logs URL",
			type: "text",
			name: "logsUrl",
			placeholder: "Enter Logs url key",
		},
	],
};
