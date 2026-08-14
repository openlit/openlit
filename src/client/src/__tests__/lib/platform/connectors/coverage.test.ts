import { ensureAdaptersRegistered, __resetBootstrapForTests } from "@/lib/platform/connectors/datasource/bootstrap";
import { ensureMemoryAdaptersRegistered, __resetMemoryBootstrapForTests } from "@/lib/platform/connectors/memory/bootstrap";
import { __resetRegistryForTests, getAdapterFactory, listSourceTypeDescriptors } from "@/lib/platform/connectors/datasource/registry";
import { __resetMemoryRegistryForTests, hasMemoryAdapterFactory } from "@/lib/platform/connectors/memory/registry";
import { __resetConnectorRegistryForTests, listConnectorTypes } from "@/lib/platform/connectors/registry";

jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));

describe("connector coverage", () => {
	afterEach(() => {
		__resetBootstrapForTests();
		__resetRegistryForTests();
		__resetMemoryBootstrapForTests();
		__resetMemoryRegistryForTests();
		__resetConnectorRegistryForTests();
	});

	it("exposes every atomic collector through the adapter and connector registries", () => {
		ensureAdaptersRegistered();
		const descriptors = listSourceTypeDescriptors();
		const connectorTypes = listConnectorTypes("datasource");

		expect(descriptors.length).toBeGreaterThanOrEqual(3);
		for (const descriptor of descriptors) {
			expect(getAdapterFactory(descriptor.type)).toBeDefined();
			expect(descriptor.declaredSignals.length).toBeGreaterThan(0);
			expect(new Set(descriptor.configFields.map((field) => field.key)).size).toBe(
				descriptor.configFields.length
			);
		}

		const registeredTypes = new Set(connectorTypes.map((descriptor) => descriptor.type));
		for (const descriptor of descriptors) expect(registeredTypes.has(descriptor.type)).toBe(true);
	});

	it("exposes memory connectors through the adapter and connector registries", () => {
		ensureMemoryAdaptersRegistered();
		expect(hasMemoryAdapterFactory("mem0")).toBe(true);
		expect(hasMemoryAdapterFactory("zep")).toBe(true);
		expect(listConnectorTypes("memory").map((item) => item.type).sort()).toEqual([
			"mem0",
			"zep",
		]);
	});
});
