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
	listSourceTypeDescriptors,
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

	it("registers every atomic vendor factory", () => {
		ensureAdaptersRegistered();
		for (const type of [
			"clickhouse",
			"datadog",
			"tempo",
			"loki",
			"prometheus",
			"mimir",
			"newrelic",
			"jaeger",
			"victoriametrics",
			"victorialogs",
		]) {
			expect(hasAdapterFactory(type)).toBe(true);
		}
	});

	it("registers stack umbrellas as internal-only (hidden from atomic pickers)", () => {
		ensureAdaptersRegistered();
		// Umbrellas ARE registered so their descriptor/stackTemplate is available,
		// but they are excluded from the atomic type list the source picker uses.
		expect(hasAdapterFactory("grafana")).toBe(true);
		expect(hasAdapterFactory("victoria")).toBe(true);
		const atomic = listSourceTypeDescriptors().map((d) => d.type);
		expect(atomic).not.toContain("grafana");
		expect(atomic).not.toContain("victoria");
		const all = listSourceTypeDescriptors({ includeInternal: true }).map(
			(d) => d.type
		);
		expect(all).toContain("grafana");
		expect(all).toContain("victoria");
	});

	it("every registered atomic type exposes a valid config schema", () => {
		ensureAdaptersRegistered();
		const descriptors = listSourceTypeDescriptors({ includeInternal: true });
		expect(descriptors.length).toBeGreaterThan(0);
		for (const d of descriptors) {
			// configFields is the single source of truth for the form — it must
			// always be an array (empty for built-in/internal), and every field
			// must be self-describing (key + label + type).
			expect(Array.isArray(d.configFields)).toBe(true);
			for (const f of d.configFields) {
				expect(typeof f.key).toBe("string");
				expect(f.key.length).toBeGreaterThan(0);
				expect(typeof f.label).toBe("string");
				expect(f.label.length).toBeGreaterThan(0);
				expect(["text", "password", "url", "switch", "select"]).toContain(
					f.kind
				);
				expect(["settings", "credentials"]).toContain(f.group);
			}
			// Atomic (non-internal) vendor sources must declare an auth style so
			// the form can render the right credential hints without per-type code.
			if (!d.internal && d.type !== "clickhouse") {
				expect(d.authStyle).toBeDefined();
			}
		}
	});
});
