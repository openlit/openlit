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
	configFields: [],
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

	it("registers a fictional descriptor-only type end to end (extensibility proof)", () => {
		// A future OTLP vendor (e.g. dash0) should plug in with just a factory
		// whose describe() returns self-describing configFields — no shared form,
		// planner, schema, or UI edits. This proves the form's single source of
		// truth (the descriptor) resolves for a type the codebase has never seen.
		const dash0Descriptor: SourceTypeDescriptor = {
			type: "dash0",
			displayName: "dash0",
			declaredSignals: ["traces", "logs", "metrics"],
			capabilities: {
				traceTree: true,
				spanEvents: true,
				serverAggregation: true,
				spanMutation: false,
				distinctValues: true,
				crossTraceSession: false,
				rawQuery: false,
			},
			correlation: { crossSignal: true, keys: ["traceId", "spanId"] },
			authStyle: "api-key",
			authHelp: "Create a dash0 auth token in Settings → Auth Tokens.",
			docsUrl: "https://www.dash0.com/documentation",
			configFields: [
				{
					key: "url",
					label: "Endpoint",
					kind: "url",
					group: "settings",
					placeholder: "https://api.dash0.com",
				},
				{
					key: "apiKey",
					label: "Auth token",
					kind: "password",
					group: "credentials",
				},
			],
		};
		const dash0Factory: DataSourceAdapterFactory = {
			type: "dash0",
			create: () => fakeAdapter,
			describe: () => dash0Descriptor,
		};

		registerAdapterFactory(dash0Factory);

		// It appears in the atomic picker list the shared form renders from...
		const listed = listSourceTypeDescriptors().find((d) => d.type === "dash0");
		expect(listed).toBeDefined();
		// ...and the form can read its fields + auth hints straight off the
		// descriptor with zero per-vendor code.
		const resolved = getSourceTypeDescriptor("dash0");
		expect(resolved?.authStyle).toBe("api-key");
		expect(resolved?.docsUrl).toContain("dash0");
		expect(resolved?.configFields.map((f) => f.key)).toEqual(["url", "apiKey"]);
		expect(resolved?.configFields.find((f) => f.key === "apiKey")?.kind).toBe(
			"password"
		);
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
