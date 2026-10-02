import {
	JaegerAdapter,
	jaegerCompatibleDescriptor,
} from "../jaeger/adapter";
import type { HealthCheckResult, TelemetrySourceDescriptor } from "../types";
import getMessage from "@/constants/messages";
import { safeFetch, SourceResponseError } from "../http/safe-fetch";

const JAEGER_SELECT_PREFIX = "/select/jaeger";

export class VictoriaTracesAdapter extends JaegerAdapter {
	readonly type = "victoriatraces";

	protected get baseUrl(): string {
		const url = String(this.descriptor.settings.url || "").replace(/\/+$/, "");
		if (!url) return url;
		if (/\/select\/jaeger$/i.test(url)) return url;
		return `${url}${JAEGER_SELECT_PREFIX}`;
	}

	/** HTTP listen origin (without `/select/jaeger`) for `/health`. */
	protected get listenOrigin(): string {
		return String(this.descriptor.settings.url || "")
			.replace(/\/+$/, "")
			.replace(/\/select\/jaeger$/i, "");
	}

	protected tenantHeader(): "X-Scope-OrgID" | "AccountID" {
		return "AccountID";
	}

	protected extraAuthHeaders(): Record<string, string> {
		const tenantProject = String(this.descriptor.settings.tenantProject || "").trim();
		return tenantProject ? { ProjectID: tenantProject } : {};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const started = Date.now();
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.listenOrigin}/health`, {
				method: "GET",
				headers: { Accept: "text/plain,application/json", ...headers },
				...this.networkOpts,
				redactValues: redact,
				timeoutMs: 10_000,
				concurrencyKey: `${this.descriptor.id}:health`,
				retry: true,
			});
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			if (error instanceof SourceResponseError && (error.status === 404 || error.status === 405)) {
				return super.healthCheck();
			}
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: String((error as Error)?.message || error),
			};
		}
	}
}

export const victoriaTracesAdapterFactory = {
	type: "victoriatraces",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new VictoriaTracesAdapter(descriptor),
	describe: () => {
		const messages = getMessage();
		return jaegerCompatibleDescriptor({
			type: "victoriatraces",
			displayName: messages.DATA_SOURCE_TYPE_VICTORIATRACES,
			description: messages.DATA_SOURCE_TYPE_VICTORIATRACES_DESCRIPTION,
			placeholder: "http://localhost:10428",
			docsUrl: messages.DATA_SOURCE_SETUP_GUIDES.victoriatraces.docsUrl,
			tenant: true,
			tenantProject: true,
		});
	},
};
