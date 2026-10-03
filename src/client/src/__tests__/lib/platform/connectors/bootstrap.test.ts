const mockEnsureAdaptersRegistered = jest.fn();
const mockEnsureMemoryAdaptersRegistered = jest.fn();
const mockEnsureScannerAdaptersRegistered = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/bootstrap", () => ({
	ensureAdaptersRegistered: (...a: unknown[]) => mockEnsureAdaptersRegistered(...a),
}));

jest.mock("@/lib/platform/connectors/memory/bootstrap", () => ({
	ensureMemoryAdaptersRegistered: (...a: unknown[]) => mockEnsureMemoryAdaptersRegistered(...a),
}));

jest.mock("@/lib/platform/connectors/scanner/bootstrap", () => ({
	ensureScannerAdaptersRegistered: (...a: unknown[]) =>
		mockEnsureScannerAdaptersRegistered(...a),
}));

import { ensureConnectorsRegistered } from "@/lib/platform/connectors/bootstrap";

beforeEach(() => {
	jest.clearAllMocks();
});

describe("ensureConnectorsRegistered", () => {
	it("registers datasource, memory, and scanner connector categories", () => {
		ensureConnectorsRegistered();

		expect(mockEnsureAdaptersRegistered).toHaveBeenCalledTimes(1);
		expect(mockEnsureMemoryAdaptersRegistered).toHaveBeenCalledTimes(1);
		expect(mockEnsureScannerAdaptersRegistered).toHaveBeenCalledTimes(1);
	});

	it("calls all registries again on every invocation", () => {
		ensureConnectorsRegistered();
		ensureConnectorsRegistered();

		expect(mockEnsureAdaptersRegistered).toHaveBeenCalledTimes(2);
		expect(mockEnsureMemoryAdaptersRegistered).toHaveBeenCalledTimes(2);
		expect(mockEnsureScannerAdaptersRegistered).toHaveBeenCalledTimes(2);
	});
});
