const mockEnsureAdaptersRegistered = jest.fn();
const mockEnsureMemoryAdaptersRegistered = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/bootstrap", () => ({
	ensureAdaptersRegistered: (...a: unknown[]) => mockEnsureAdaptersRegistered(...a),
}));

jest.mock("@/lib/platform/connectors/memory/bootstrap", () => ({
	ensureMemoryAdaptersRegistered: (...a: unknown[]) => mockEnsureMemoryAdaptersRegistered(...a),
}));

import { ensureConnectorsRegistered } from "@/lib/platform/connectors/bootstrap";

beforeEach(() => {
	jest.clearAllMocks();
});

describe("ensureConnectorsRegistered", () => {
	it("registers both datasource and memory connector categories", () => {
		ensureConnectorsRegistered();

		expect(mockEnsureAdaptersRegistered).toHaveBeenCalledTimes(1);
		expect(mockEnsureMemoryAdaptersRegistered).toHaveBeenCalledTimes(1);
	});

	it("calls both registries again on every invocation", () => {
		ensureConnectorsRegistered();
		ensureConnectorsRegistered();

		expect(mockEnsureAdaptersRegistered).toHaveBeenCalledTimes(2);
		expect(mockEnsureMemoryAdaptersRegistered).toHaveBeenCalledTimes(2);
	});
});
