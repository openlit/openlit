jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => [],
}));
jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
}));
jest.mock("@/lib/platform/request", () => ({
	getRequests: jest.fn(),
	getRequestViaSpanId: jest.fn(),
	getAttributeKeys: jest.fn(),
}));
jest.mock("@/lib/platform/observability", () => ({
	getLogs: jest.fn(),
	getLogByRowId: jest.fn(),
	getMetrics: jest.fn(),
	getMetricsConfig: jest.fn(),
	getLogAttributeKeys: jest.fn(),
	getMetricAttributeKeys: jest.fn(),
}));

import {
	__resetBootstrapForTests,
	ensureAdaptersRegistered,
} from "@/lib/platform/datasource/bootstrap";
import {
	__resetRegistryForTests,
	createAdapter,
	hasAdapterFactory,
} from "@/lib/platform/datasource/registry";
import { ClickHouseAdapter } from "@/lib/platform/datasource/clickhouse/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/datasource/types";

beforeEach(() => {
	__resetRegistryForTests();
	__resetBootstrapForTests();
});

describe("datasource bootstrap", () => {
	it("registers the built-in ClickHouse factory exactly once", () => {
		ensureAdaptersRegistered();
		ensureAdaptersRegistered();
		expect(hasAdapterFactory("clickhouse")).toBe(true);
	});

	it("creates a ClickHouseAdapter from a built-in descriptor", () => {
		ensureAdaptersRegistered();
		const descriptor: TelemetrySourceDescriptor = {
			type: "clickhouse",
			id: "builtin:db-1",
			isBuiltIn: true,
			settings: {},
			dbConfigId: "db-1",
			signals: ["traces", "logs", "metrics"],
			name: "CH",
		};
		expect(createAdapter(descriptor)).toBeInstanceOf(ClickHouseAdapter);
	});

	it("registers every built-in vendor factory", () => {
		ensureAdaptersRegistered();
		for (const type of [
			"clickhouse",
			"datadog",
			"grafana",
			"tempo",
			"loki",
			"prometheus",
			"mimir",
			"newrelic",
			"jaeger",
			"victoria",
			"victoriametrics",
			"victorialogs",
		]) {
			expect(hasAdapterFactory(type)).toBe(true);
		}
	});
});
