const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	SourceResponseError: class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
	selfHostedNetworkOptions: () => ({
		allowHttp: true,
		allowPrivateNetwork: true,
	}),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => ["tok"],
}));

import { resolveSourceSecret } from "@/lib/platform/connectors/datasource/http/secret";
import { MimirAdapter, mimirAdapterFactory } from "@/lib/platform/connectors/datasource/mimir/adapter";
import {
	VictoriaMetricsAdapter,
	victoriaMetricsAdapterFactory,
} from "@/lib/platform/connectors/datasource/victoria-metrics/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";

const window = {
	start: new Date("2026-08-05T00:00:00Z"),
	end: new Date("2026-08-05T01:00:00Z"),
};

function descriptor(
	type: "mimir" | "victoriametrics",
	settings: Record<string, unknown> = {}
): TelemetrySourceDescriptor {
	return {
		type,
		id: `source-${type}`,
		isBuiltIn: false,
		settings: {
			url: type === "mimir" ? "http://mimir:9009" : "http://victoriametrics:8428",
			allowHttp: true,
			allowPrivateNetwork: true,
			...settings,
		},
		signals: ["metrics"],
		name: type,
	};
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	(resolveSourceSecret as jest.Mock).mockReset();
	(resolveSourceSecret as jest.Mock).mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok", tenant: "team-a" },
	});
});

describe("mimir adapter", () => {
	it("describes a Prometheus-compatible metrics type", () => {
		const info = mimirAdapterFactory.describe();
		expect(info.type).toBe("mimir");
		expect(info.declaredSignals).toEqual(["metrics"]);
		expect(mimirAdapterFactory.create(descriptor("mimir"))).toBeInstanceOf(MimirAdapter);
	});

	it("health-checks buildinfo and sends X-Scope-OrgID", async () => {
		mockSafeFetch.mockResolvedValue({ status: "success", data: { version: "2.14" } });
		const adapter = new MimirAdapter(descriptor("mimir"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/api/v1/status/buildinfo");
		expect(mockSafeFetch.mock.calls[0][1].headers["X-Scope-OrgID"]).toBe("team-a");
		expect(mockSafeFetch.mock.calls[0][1].headers.AccountID).toBeUndefined();
	});

	it("falls back to labelNames when buildinfo fails", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(new Error("no buildinfo"))
			.mockResolvedValueOnce({ status: "success", data: ["job"] });
		const adapter = new MimirAdapter(descriptor("mimir"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(String(mockSafeFetch.mock.calls[1][0])).toContain("/api/v1/labels");
	});
});

describe("victoria metrics adapter", () => {
	it("describes AccountID tenant plus optional ProjectID", () => {
		const info = victoriaMetricsAdapterFactory.describe();
		expect(info.type).toBe("victoriametrics");
		expect(info.configFields.some((field) => field.key === "tenantProject")).toBe(true);
		expect(
			victoriaMetricsAdapterFactory.create(descriptor("victoriametrics"))
		).toBeInstanceOf(VictoriaMetricsAdapter);
	});

	it("health-checks buildinfo and sends AccountID plus ProjectID", async () => {
		mockSafeFetch.mockResolvedValue({ status: "success", data: {} });
		const adapter = new VictoriaMetricsAdapter(
			descriptor("victoriametrics", { tenantProject: "34" })
		);
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		const headers = mockSafeFetch.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.AccountID).toBe("team-a");
		expect(headers.ProjectID).toBe("34");
		expect(headers["X-Scope-OrgID"]).toBeUndefined();
	});

	it("queries PromQL through the Prometheus-compatible API", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "matrix",
				result: [{ metric: { __name__: "up", service_name: "api" }, values: [[1785888000, "1"]] }],
			},
		});
		const adapter = new VictoriaMetricsAdapter(descriptor("victoriametrics"));
		const frame = await adapter.listMetricSeries({ signal: "metrics", timeRange: window });
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.origin).toBe("http://victoriametrics:8428");
		expect(url.pathname).toBe("/api/v1/query_range");
		expect(frame.rows[0]).toMatchObject({
			serviceName: "api",
			metricName: "up",
		});
	});
});
