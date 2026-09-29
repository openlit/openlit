import {
	__resetConnectorRegistryForTests,
	createConnectorRuntime,
	getConnectorType,
	listConnectorTypes,
	registerConnectorType,
} from "@/lib/platform/connectors";

describe("connector registry", () => {
	afterEach(() => {
		__resetConnectorRegistryForTests();
	});

	it("registers connector types by category and type", () => {
		registerConnectorType({
			descriptor: {
				type: "test-memory",
				category: "memory",
				displayName: "Test memory",
				scope: "project",
				configFields: [],
				capabilities: { read: true },
			},
		});

		expect(getConnectorType("memory", "test-memory")?.descriptor.displayName).toBe(
			"Test memory"
		);
		expect(listConnectorTypes("memory")).toHaveLength(1);
		expect(listConnectorTypes("datasource")).toHaveLength(0);
	});

	it("creates a runtime from a configured connector instance", async () => {
		registerConnectorType({
			descriptor: {
				type: "test-notification",
				category: "notification",
				displayName: "Test notification",
				scope: "organisation",
				configFields: [],
				capabilities: { notify: true },
			},
			create: () => ({ healthCheck: async () => ({ ok: true }) }),
		});

		const runtime = createConnectorRuntime({
			id: "connector-1",
			type: "test-notification",
			category: "notification",
			name: "Test",
			organisationId: "org-1",
			settings: {},
		});

		expect(await runtime?.healthCheck()).toEqual({ ok: true });
	});
});

