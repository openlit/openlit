import {
	__resetMemoryBootstrapForTests,
	ensureMemoryAdaptersRegistered,
} from "@/lib/platform/connectors/memory/bootstrap";
import {
	__resetMemoryRegistryForTests,
	createMemoryAdapter,
	hasMemoryAdapterFactory,
	listMemoryTypeDescriptors,
} from "@/lib/platform/connectors/memory/registry";
import {
	__resetConnectorRegistryForTests,
	listConnectorTypes,
} from "@/lib/platform/connectors/registry";
import { Mem0Adapter } from "@/lib/platform/connectors/memory/mem0/adapter";
import type { MemorySourceDescriptor } from "@/lib/platform/connectors/memory/types";

jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));

beforeEach(() => {
	__resetMemoryRegistryForTests();
	__resetMemoryBootstrapForTests();
	__resetConnectorRegistryForTests();
});

describe("memory connector bootstrap", () => {
	it("registers Claude, Mem0, and Zep exactly once", () => {
		ensureMemoryAdaptersRegistered();
		ensureMemoryAdaptersRegistered();
		expect(hasMemoryAdapterFactory("claude")).toBe(true);
		expect(hasMemoryAdapterFactory("mem0")).toBe(true);
		expect(hasMemoryAdapterFactory("zep")).toBe(true);
		expect(listMemoryTypeDescriptors().map((item) => item.type).sort()).toEqual([
			"claude",
			"mem0",
			"zep",
		]);
	});

	it("creates a Mem0 adapter from a descriptor", () => {
		ensureMemoryAdaptersRegistered();
		const descriptor: MemorySourceDescriptor = {
			type: "mem0",
			id: "memory:1",
			settings: { url: "https://api.mem0.ai" },
			name: "Mem0",
		};
		expect(createMemoryAdapter(descriptor)).toBeInstanceOf(Mem0Adapter);
	});

	it("re-registers after the registry Map is cleared", () => {
		ensureMemoryAdaptersRegistered();
		__resetMemoryRegistryForTests();
		expect(hasMemoryAdapterFactory("mem0")).toBe(false);
		ensureMemoryAdaptersRegistered();
		expect(hasMemoryAdapterFactory("mem0")).toBe(true);
	});

	it("exposes memory types through the generic connector registry", () => {
		ensureMemoryAdaptersRegistered();
		expect(listConnectorTypes("memory").map((item) => item.type).sort()).toEqual([
			"claude",
			"mem0",
			"zep",
		]);
		expect(listConnectorTypes("datasource")).toHaveLength(0);
	});

	it("every registered type exposes a valid config schema", () => {
		ensureMemoryAdaptersRegistered();
		for (const descriptor of listMemoryTypeDescriptors()) {
			expect(descriptor.configFields.length).toBeGreaterThan(0);
			for (const field of descriptor.configFields) {
				expect(field.key).toBeTruthy();
				expect(field.label).toBeTruthy();
				expect(["settings", "credentials"]).toContain(field.group);
			}
			expect(descriptor.authStyle).toBe("api-key");
		}
	});
});
