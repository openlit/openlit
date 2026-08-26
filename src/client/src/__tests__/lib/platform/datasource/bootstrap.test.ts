jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
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
} from "@/lib/platform/connectors/datasource/bootstrap";
import {
	__resetRegistryForTests,
	createAdapter,
	hasAdapterFactory,
	listSourceTypeDescriptors,
} from "@/lib/platform/connectors/datasource/registry";
import { ClickHouseAdapter } from "@/lib/platform/connectors/datasource/clickhouse/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";

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

	it("registers only the supported CE connector factories", () => {
		ensureAdaptersRegistered();
		for (const type of [
			"clickhouse",
			"tempo",
			"loki",
			"prometheus",
			"jaeger",
		]) {
			expect(hasAdapterFactory(type)).toBe(true);
		}
		for (const type of ["datadog", "mimir", "victoriametrics", "victorialogs"]) {
			expect(hasAdapterFactory(type)).toBe(false);
		}
	});

	it("re-registers after the registry Map is cleared (HMR-safe)", () => {
		ensureAdaptersRegistered();
		expect(hasAdapterFactory("loki")).toBe(true);
		// Simulate Next.js HMR reloading registry.ts into an empty Map while
		// bootstrap's module-level `registered` flag remains true.
		__resetRegistryForTests();
		expect(hasAdapterFactory("loki")).toBe(false);
		ensureAdaptersRegistered();
		expect(hasAdapterFactory("loki")).toBe(true);
		expect(hasAdapterFactory("prometheus")).toBe(true);
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
