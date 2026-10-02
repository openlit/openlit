import {
	PrometheusAdapter,
	prometheusCompatibleDescriptor,
} from "../prometheus/adapter";
import type { HealthCheckResult, TelemetrySourceDescriptor } from "../types";
import getMessage from "@/constants/messages";

export class VictoriaMetricsAdapter extends PrometheusAdapter {
	readonly type = "victoriametrics";

	protected tenantHeader(): "X-Scope-OrgID" | "AccountID" {
		return "AccountID";
	}

	async healthCheck(): Promise<HealthCheckResult> {
		return this.healthCheckViaBuildinfo();
	}
}

export const victoriaMetricsAdapterFactory = {
	type: "victoriametrics",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new VictoriaMetricsAdapter(descriptor),
	describe: () => {
		const messages = getMessage();
		return prometheusCompatibleDescriptor({
			type: "victoriametrics",
			displayName: messages.DATA_SOURCE_TYPE_VICTORIAMETRICS,
			description: messages.DATA_SOURCE_TYPE_VICTORIAMETRICS_DESCRIPTION,
			placeholder: "http://localhost:8428",
			docsUrl: messages.DATA_SOURCE_SETUP_GUIDES.victoriametrics.docsUrl,
			tenantProject: true,
		});
	},
};
