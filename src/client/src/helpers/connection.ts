import { isEmpty } from "lodash";

export const CONNECTION_PLATFORM = {
	grafana: "grafana",
	datadog: "datadog",
	newrelic: "newrelic",
	dynatrace: "dynatrace",
	signoz: "signoz",
};

export type CONNECTION_PLATFORM_TYPE = keyof typeof CONNECTION_PLATFORM;

export type CONNECTION_PARAMS = {
	platform: CONNECTION_PLATFORM_TYPE;
	apiKey: string;
	logsUsername?: string;
	logsUrl?: string;
	metricsUsername?: string;
	metricsUrl?: string;
};

export const validateConnectionRequest = (
	request: CONNECTION_PARAMS
): { success: boolean; err?: string } => {
	switch (request.platform) {
		case "grafana":
		case "datadog":
		case "newrelic":
		case "dynatrace":
			if (isEmpty(request.apiKey))
				return {
					success: false,
					err: "Api key missing!",
				};
			if (isEmpty(request.metricsUsername))
				return {
					success: false,
					err: "Metrics username missing!",
				};
			if (isEmpty(request.metricsUrl))
				return {
					success: false,
					err: "Metrics url missing!",
				};
			if (isEmpty(request.logsUsername))
				return {
					success: false,
					err: "Logs username missing!",
				};
			if (isEmpty(request.logsUrl))
				return {
					success: false,
					err: "Logs url missing!",
				};

			return { success: true };
		case "signoz":
			if (isEmpty(request.apiKey))
				return {
					success: false,
					err: "Api key missing!",
				};
			if (isEmpty(request.logsUrl))
				return {
					success: false,
					err: "Logs url missing!",
				};

			return { success: true };
		default:
			return {
				success: false,
				err: "No other platform is supported for now!",
			};
	}
};
