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
import {
	VictoriaLogsAdapter,
	victoriaLogsAdapterFactory,
	__resetVictoriaLogsForTests,
} from "@/lib/platform/connectors/datasource/victoria-logs/adapter";
import { victoriaLogsSelector } from "@/lib/platform/connectors/datasource/victoria-logs/selector";
import {
	UnsupportedCapabilityError,
	type TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";
import { logStableRowId } from "@/lib/platform/connectors/datasource/clickhouse/normalize";

const window = {
	start: new Date("2026-08-05T00:00:00Z"),
	end: new Date("2026-08-05T01:00:00Z"),
};

function descriptor(
	settings: Record<string, unknown> = {}
): TelemetrySourceDescriptor {
	return {
		type: "victorialogs",
		id: "source-victorialogs",
		isBuiltIn: false,
		settings: {
			url: "http://victoria-logs:9428",
			allowHttp: true,
			allowPrivateNetwork: true,
			...settings,
		},
		signals: ["logs"],
		name: "VictoriaLogs",
	};
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	(resolveSourceSecret as jest.Mock).mockReset();
	(resolveSourceSecret as jest.Mock).mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok", tenant: "12" },
	});
	__resetVictoriaLogsForTests();
});

describe("victoriaLogsSelector", () => {
	it("compiles attribute and body filters to LogsQL", () => {
		expect(
			victoriaLogsSelector(
				{
					signal: "logs",
					timeRange: window,
					filters: [
						{ target: "attribute", key: "service.name", op: "eq", value: "checkout" },
						{ target: "attribute", key: "body", op: "eq", value: "failed" },
					],
				},
				"*"
			)
		).toBe('service_name:="checkout" "failed"');
	});

	it("falls back when there are no filters", () => {
		expect(victoriaLogsSelector({ signal: "logs", timeRange: window }, "*")).toBe("*");
	});
});

describe("victoria logs adapter", () => {
	it("describes a logs-only type", () => {
		const info = victoriaLogsAdapterFactory.describe();
		expect(info.type).toBe("victorialogs");
		expect(info.declaredSignals).toEqual(["logs"]);
		expect(info.capabilities.traceTree).toBe(false);
	});

	it("lists logs from NDJSON and sends AccountID plus ProjectID", async () => {
		mockSafeFetch.mockResolvedValue(
			'{"_msg":"failed","_time":"2026-08-05T00:01:00Z","service_name":"checkout","trace_id":"trace-1"}\n{"_msg":"ok","_time":"2026-08-05T00:02:00Z","service_name":"checkout"}\n'
		);
		const adapter = new VictoriaLogsAdapter(descriptor({ tenantProject: "34" }));
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "attribute", key: "service.name", op: "eq", value: "checkout" },
			],
			limit: 25,
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.origin).toBe("http://victoria-logs:9428");
		expect(url.pathname).toBe("/select/logsql/query");
		expect(mockSafeFetch.mock.calls[0][1].method).toBe("POST");
		expect(mockSafeFetch.mock.calls[0][1].body).toContain("query=");
		expect(mockSafeFetch.mock.calls[0][1].headers.AccountID).toBe("12");
		expect(mockSafeFetch.mock.calls[0][1].headers.ProjectID).toBe("34");
		expect(frame.rows[0]).toMatchObject({
			body: "failed",
			traceId: "trace-1",
			serviceName: "checkout",
		});
	});

	it("builds hits time series and health-checks /health", async () => {
		mockSafeFetch.mockResolvedValueOnce("OK");
		const adapter = new VictoriaLogsAdapter(descriptor());
		const health = await adapter.healthCheck();
		expect(health.ok).toBe(true);
		expect(new URL(mockSafeFetch.mock.calls[0][0]).pathname).toBe("/health");

		mockSafeFetch.mockResolvedValueOnce({
			hits: [
				{
					fields: {},
					timestamps: ["2026-08-05T00:00:00Z", "2026-08-05T00:30:00Z"],
					values: [4, 7],
				},
			],
		});
		const series = await adapter.logTimeSeries({ signal: "logs", timeRange: window });
		expect(new URL(mockSafeFetch.mock.calls[1][0]).pathname).toBe("/select/logsql/hits");
		expect(series.rows).toEqual([
			expect.objectContaining({ timestamp: "2026-08-05T00:00:00Z", count: 4 }),
			expect.objectContaining({ timestamp: "2026-08-05T00:30:00Z", count: 7 }),
		]);
	});

	it("returns cached logs from getLog and throws on trace capabilities", async () => {
		mockSafeFetch.mockResolvedValue(
			'{"_msg":"failed","_time":"2026-08-05T00:01:00Z","trace_id":"t1","span_id":"s1"}\n'
		);
		const adapter = new VictoriaLogsAdapter(descriptor());
		const frame = await adapter.listLogs({ signal: "logs", timeRange: window });
		const id = logStableRowId(frame.rows[0]);
		const found = await adapter.getLog(id);
		expect(found?.body).toBe("failed");
		await expect(adapter.listSpans({ signal: "traces", timeRange: window })).rejects.toBeInstanceOf(
			UnsupportedCapabilityError
		);
		await expect(adapter.listMetricSeries({ signal: "metrics", timeRange: window })).rejects.toBeInstanceOf(
			UnsupportedCapabilityError
		);
	});

	it("discovers field names and values", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			values: [{ value: "service_name", hits: 2 }, { value: "_msg", hits: 2 }],
		});
		const adapter = new VictoriaLogsAdapter(descriptor());
		await expect(adapter.attributeKeys("logs", window)).resolves.toEqual([
			"service_name",
			"_msg",
		]);
		mockSafeFetch.mockResolvedValueOnce({
			values: [{ value: "checkout" }, { value: "payments" }],
		});
		await expect(
			adapter.distinctValues("service.name", { signal: "logs", timeRange: window })
		).resolves.toEqual(["checkout", "payments"]);
		expect(mockSafeFetch.mock.calls[1][1].body).toContain("field=service_name");
	});
});
