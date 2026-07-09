import {
	__resetRegistryForTests,
	createAdapter,
	getAdapterFactory,
	getSourceTypeDescriptor,
	hasAdapterFactory,
	listAdapterTypes,
	listSourceTypeDescriptors,
	registerAdapterFactory,
} from "@/lib/platform/datasource/registry";
import { getExternalDataSourceAdapters } from "@/lib/platform/datasource/enterprise";
import type {
	DataSourceAdapter,
	DataSourceAdapterFactory,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "@/lib/platform/datasource/types";

const fakeAdapter = { type: "clickhouse" } as unknown as DataSourceAdapter;

const fakeTypeDescriptor: SourceTypeDescriptor = {
	type: "clickhouse",
	displayName: "ClickHouse",
	declaredSignals: ["traces", "logs", "metrics"],
	capabilities: {
		traceTree: true,
		spanEvents: true,
		serverAggregation: true,
		spanMutation: true,
		distinctValues: true,
		crossTraceSession: true,
		rawQuery: true,
	},
	correlation: { crossSignal: true, keys: ["traceId", "spanId", "service", "session"] },
};

const internalTypeDescriptor: SourceTypeDescriptor = {
	...fakeTypeDescriptor,
	type: "grafana",
	displayName: "Grafana stack",
	internal: true,
};

const fakeFactory: DataSourceAdapterFactory = {
	type: "clickhouse",
	create: () => fakeAdapter,
	describe: () => fakeTypeDescriptor,
};

const internalFactory: DataSourceAdapterFactory = {
	type: "grafana",
	create: () => fakeAdapter,
	describe: () => internalTypeDescriptor,
};

const descriptor: TelemetrySourceDescriptor = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["traces", "logs", "metrics"],
	name: "CH",
};

beforeEach(() => {
	__resetRegistryForTests();
});

describe("datasource registry", () => {
	it("CE enterprise hook returns no external adapters", () => {
		expect(getExternalDataSourceAdapters()).toEqual([]);
	});

	it("registers and retrieves a factory by type", () => {
		registerAdapterFactory(fakeFactory);
		expect(hasAdapterFactory("clickhouse")).toBe(true);
		expect(getAdapterFactory("clickhouse")).toBe(fakeFactory);
		expect(listAdapterTypes()).toContain("clickhouse");
	});

	it("creates an adapter from a descriptor", () => {
		registerAdapterFactory(fakeFactory);
		expect(createAdapter(descriptor)).toBe(fakeAdapter);
	});

	it("returns undefined for an unregistered type (EE type on CE)", () => {
		expect(getAdapterFactory("datadog")).toBeUndefined();
		expect(createAdapter({ ...descriptor, type: "datadog" })).toBeUndefined();
	});

	it("exposes static type descriptors and excludes internal stack types", () => {
		registerAdapterFactory(fakeFactory);
		registerAdapterFactory(internalFactory);
		expect(getSourceTypeDescriptor("clickhouse")?.declaredSignals).toEqual([
			"traces",
			"logs",
			"metrics",
		]);
		const atomic = listSourceTypeDescriptors().map((d) => d.type);
		expect(atomic).toContain("clickhouse");
		expect(atomic).not.toContain("grafana");
		const all = listSourceTypeDescriptors({ includeInternal: true }).map(
			(d) => d.type
		);
		expect(all).toContain("grafana");
	});
});
