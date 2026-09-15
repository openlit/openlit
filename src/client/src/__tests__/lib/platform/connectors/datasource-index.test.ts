const mockListSourceTypeDescriptors = jest.fn();
const mockCreateAdapter = jest.fn();
const mockRegisterConnectorType = jest.fn();
const mockConnectorIconPath = jest.fn((..._a: unknown[]) => "/icons/mock.svg");
const mockConnectorDescription = jest.fn((..._a: unknown[]) => "Mock description");

jest.mock("@/lib/platform/connectors/datasource/registry", () => ({
	listSourceTypeDescriptors: (...a: unknown[]) => mockListSourceTypeDescriptors(...a),
	createAdapter: (...a: unknown[]) => mockCreateAdapter(...a),
}));

jest.mock("@/lib/platform/connectors/registry", () => ({
	registerConnectorType: (...a: unknown[]) => mockRegisterConnectorType(...a),
}));

jest.mock("@/lib/platform/connectors/icons", () => ({
	connectorIconPath: (...a: unknown[]) => mockConnectorIconPath(...a),
}));

jest.mock("@/lib/platform/connectors/descriptions", () => ({
	connectorDescription: (...a: unknown[]) => mockConnectorDescription(...a),
}));

import { registerDatasourceConnectorTypes } from "@/lib/platform/connectors/datasource/index";

function fieldDescriptor(kind: string) {
	return {
		type: "tempo",
		displayName: "Tempo",
		declaredSignals: ["traces"],
		capabilities: {},
		correlation: {},
		configFields: [
			{ key: "endpoint", label: "Endpoint", kind, group: "connection" },
		],
	};
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("registerDatasourceConnectorTypes", () => {
	it("does nothing when there are no source type descriptors", () => {
		mockListSourceTypeDescriptors.mockReturnValue([]);
		registerDatasourceConnectorTypes();
		expect(mockRegisterConnectorType).not.toHaveBeenCalled();
	});

	it.each([
		["switch", "boolean"],
		["password", "password"],
		["url", "url"],
		["select", "select"],
		["text", "text"],
		["unknown-kind", "text"],
	])("maps configField kind %s to connector field kind %s", (kind, expected) => {
		mockListSourceTypeDescriptors.mockReturnValue([fieldDescriptor(kind)]);
		registerDatasourceConnectorTypes();

		const registration = mockRegisterConnectorType.mock.calls[0][0];
		expect(registration.descriptor.configFields[0].kind).toBe(expected);
	});

	it("registers one connector type per source descriptor with the mapped metadata", () => {
		mockListSourceTypeDescriptors.mockReturnValue([
			{
				type: "tempo",
				displayName: "Tempo",
				declaredSignals: ["traces"],
				capabilities: { readSpans: true },
				correlation: {},
				internal: false,
				configFields: [
					{
						key: "endpoint",
						label: "Endpoint",
						kind: "url",
						group: "connection",
						defaultValue: "http://localhost",
						options: undefined,
					},
				],
			},
		]);
		registerDatasourceConnectorTypes();

		expect(mockRegisterConnectorType).toHaveBeenCalledTimes(1);
		const registration = mockRegisterConnectorType.mock.calls[0][0];
		expect(registration.descriptor).toMatchObject({
			type: "tempo",
			category: "datasource",
			displayName: "Tempo",
			description: "Mock description",
			icon: "/icons/mock.svg",
			scope: "project",
			capabilities: { readSpans: true },
			internal: false,
		});
		expect(mockConnectorDescription).toHaveBeenCalledWith("tempo", "Tempo");
		expect(mockConnectorIconPath).toHaveBeenCalledWith("tempo");
	});

	it("marks clickhouse instances as built-in and defaults a missing projectId to null", () => {
		mockListSourceTypeDescriptors.mockReturnValue([
			{
				type: "clickhouse",
				displayName: "ClickHouse",
				declaredSignals: ["traces"],
				capabilities: {},
				correlation: {},
				configFields: [],
			},
		]);
		registerDatasourceConnectorTypes();
		const { create } = mockRegisterConnectorType.mock.calls[0][0];

		const adapter = { healthCheck: jest.fn() };
		mockCreateAdapter.mockReturnValue(adapter);
		const result = create({
			id: "inst-1",
			type: "clickhouse",
			category: "datasource",
			name: "Primary",
			settings: { foo: "bar" },
			secretRef: "secret-1",
		});

		expect(result).toBe(adapter);
		const source = mockCreateAdapter.mock.calls[0][0];
		expect(source).toMatchObject({
			type: "clickhouse",
			id: "inst-1",
			isBuiltIn: true,
			settings: { foo: "bar" },
			secretRef: "secret-1",
			signals: ["traces"],
			projectId: null,
			name: "Primary",
		});
	});

	it("marks non-clickhouse instances as not built-in and preserves an explicit projectId", () => {
		mockListSourceTypeDescriptors.mockReturnValue([
			{
				type: "tempo",
				displayName: "Tempo",
				declaredSignals: ["traces"],
				capabilities: {},
				correlation: {},
				configFields: [],
			},
		]);
		registerDatasourceConnectorTypes();
		const { create } = mockRegisterConnectorType.mock.calls[0][0];

		mockCreateAdapter.mockReturnValue({ healthCheck: jest.fn() });
		create({
			id: "inst-2",
			type: "tempo",
			category: "datasource",
			name: "Secondary",
			settings: {},
			projectId: "proj-9",
			environment: "production",
		});

		const source = mockCreateAdapter.mock.calls[0][0];
		expect(source).toMatchObject({
			isBuiltIn: false,
			projectId: "proj-9",
			environment: "production",
		});
	});

	it("throws when the adapter factory returns no adapter", () => {
		mockListSourceTypeDescriptors.mockReturnValue([
			{
				type: "tempo",
				displayName: "Tempo",
				declaredSignals: ["traces"],
				capabilities: {},
				correlation: {},
				configFields: [],
			},
		]);
		registerDatasourceConnectorTypes();
		const { create } = mockRegisterConnectorType.mock.calls[0][0];

		mockCreateAdapter.mockReturnValue(undefined);
		expect(() =>
			create({
				id: "inst-3",
				type: "tempo",
				category: "datasource",
				name: "Missing",
				settings: {},
			})
		).toThrow("Connector adapter unavailable: tempo");
	});
});
