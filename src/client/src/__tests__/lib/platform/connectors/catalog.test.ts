const mockEnsureConnectorsRegistered = jest.fn();
const mockAvailableSourceTypeDescriptors = jest.fn();
const mockAvailableMemoryTypeDescriptors = jest.fn();
const mockAvailableScannerTypeDescriptors = jest.fn();
const mockIsVisibleConnectorType = jest.fn();
const mockConnectorIconPath = jest.fn();

jest.mock("@/lib/platform/connectors/bootstrap", () => ({
	ensureConnectorsRegistered: (...a: unknown[]) => mockEnsureConnectorsRegistered(...a),
}));

jest.mock("@/lib/telemetry-source-crud", () => ({
	availableSourceTypeDescriptors: (...a: unknown[]) => mockAvailableSourceTypeDescriptors(...a),
}));

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	availableMemoryTypeDescriptors: (...a: unknown[]) => mockAvailableMemoryTypeDescriptors(...a),
}));

jest.mock("@/lib/platform/connectors/scanner/crud", () => ({
	availableScannerTypeDescriptors: (...a: unknown[]) => mockAvailableScannerTypeDescriptors(...a),
}));

jest.mock("@/lib/platform/connectors/visible-types", () => ({
	isVisibleConnectorType: (...a: unknown[]) => mockIsVisibleConnectorType(...a),
}));

jest.mock("@/lib/platform/connectors/icons", () => ({
	connectorIconPath: (...a: unknown[]) => mockConnectorIconPath(...a),
}));

import { availableConnectorTypeDescriptors } from "@/lib/platform/connectors/catalog";

beforeEach(() => {
	jest.clearAllMocks();
	mockAvailableSourceTypeDescriptors.mockReturnValue([]);
	mockAvailableMemoryTypeDescriptors.mockReturnValue([]);
	mockAvailableScannerTypeDescriptors.mockReturnValue([]);
	mockIsVisibleConnectorType.mockReturnValue(true);
});

describe("availableConnectorTypeDescriptors", () => {
	it("registers connectors before building the catalog", () => {
		availableConnectorTypeDescriptors();
		expect(mockEnsureConnectorsRegistered).toHaveBeenCalledTimes(1);
	});

	it("merges category/scope onto datasource descriptors and keeps an existing icon", () => {
		mockAvailableSourceTypeDescriptors.mockReturnValue([
			{ type: "tempo", displayName: "Tempo", icon: "/icons/tempo.svg" },
		]);

		const result = availableConnectorTypeDescriptors();

		expect(result).toEqual([
			expect.objectContaining({
				type: "tempo",
				icon: "/icons/tempo.svg",
				category: "datasource",
				scope: "project",
			}),
		]);
		expect(mockConnectorIconPath).not.toHaveBeenCalled();
	});

	it("falls back to connectorIconPath when a datasource descriptor has no icon", () => {
		mockAvailableSourceTypeDescriptors.mockReturnValue([
			{ type: "loki", displayName: "Loki" },
		]);
		mockConnectorIconPath.mockReturnValue("/icons/loki.svg");

		const result = availableConnectorTypeDescriptors();

		expect(mockConnectorIconPath).toHaveBeenCalledWith("loki");
		expect(result).toEqual([
			expect.objectContaining({ type: "loki", icon: "/icons/loki.svg" }),
		]);
	});

	it("passes memory descriptors through unchanged", () => {
		mockAvailableMemoryTypeDescriptors.mockReturnValue([
			{ type: "mem0", displayName: "Mem0", category: "memory", scope: "project" },
		]);

		const result = availableConnectorTypeDescriptors();

		expect(result).toEqual([
			{ type: "mem0", displayName: "Mem0", category: "memory", scope: "project" },
		]);
	});

	it("filters out hidden connector types", () => {
		mockAvailableSourceTypeDescriptors.mockReturnValue([
			{ type: "tempo", displayName: "Tempo", icon: "/icons/tempo.svg" },
			{ type: "datadog", displayName: "Datadog", icon: "/icons/datadog.svg" },
		]);
		mockAvailableMemoryTypeDescriptors.mockReturnValue([
			{ type: "mem0", displayName: "Mem0" },
		]);
		mockIsVisibleConnectorType.mockImplementation((type: unknown) => type !== "datadog");

		const result = availableConnectorTypeDescriptors();

		expect(result.map((descriptor) => descriptor.type)).toEqual(["tempo", "mem0"]);
	});
});
