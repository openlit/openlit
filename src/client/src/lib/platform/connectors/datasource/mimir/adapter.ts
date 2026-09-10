import {
	PrometheusAdapter,
	prometheusCompatibleDescriptor,
} from "../prometheus/adapter";
import type { HealthCheckResult, TelemetrySourceDescriptor } from "../types";
import getMessage from "@/constants/messages";

export class MimirAdapter extends PrometheusAdapter {
	readonly type = "mimir";

	async healthCheck(): Promise<HealthCheckResult> {
		return this.healthCheckViaBuildinfo();
	}
}

export const mimirAdapterFactory = {
	type: "mimir",
	create: (descriptor: TelemetrySourceDescriptor) => new MimirAdapter(descriptor),
	describe: () => {
		const messages = getMessage();
		return prometheusCompatibleDescriptor({
			type: "mimir",
			displayName: messages.DATA_SOURCE_TYPE_MIMIR,
			description: messages.DATA_SOURCE_TYPE_MIMIR_DESCRIPTION,
			placeholder: "https://prometheus-prod-xx.grafana.net/api/prom",
			docsUrl: messages.DATA_SOURCE_SETUP_GUIDES.mimir.docsUrl,
		});
	},
};
