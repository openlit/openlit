import {
	TENANT_FILTERED_OTEL_TABLES,
	tenantReadFilterSettings,
	tenantRowPredicate,
} from "@/lib/platform/clickhouse/tenant-read-filter";

describe("tenant read filter", () => {
	const original = process.env.OPENLIT_TENANT_READ_FILTER;
	afterEach(() => {
		if (original === undefined) delete process.env.OPENLIT_TENANT_READ_FILTER;
		else process.env.OPENLIT_TENANT_READ_FILTER = original;
	});

	it("scopes rows to the config project and environment, keeping unstamped rows", () => {
		expect(
			tenantRowPredicate({ projectId: "proj1", environment: "staging", database: "openlit" })
		).toBe(
			"ResourceAttributes['openlit.project.id'] IN ('', 'proj1') AND ResourceAttributes['organisation.environment.name'] IN ('', 'staging')"
		);
	});

	it("does not filter configs without a project", () => {
		expect(tenantRowPredicate({ projectId: null, environment: "production", database: "openlit" })).toBeNull();
		expect(
			tenantReadFilterSettings({ projectId: null, environment: "production", database: "openlit" })
		).toBeUndefined();
	});

	it("fails closed for unsafe identifiers", () => {
		expect(
			tenantRowPredicate({ projectId: "p') OR 1=1 --", environment: "production", database: "openlit" })
		).toBe("0");
		expect(
			tenantRowPredicate({ projectId: "proj1", environment: "Prod'", database: "openlit" })
		).toBe("0");
	});

	it("covers every OTLP table, qualified and unqualified", () => {
		const settings = tenantReadFilterSettings({
			projectId: "proj1",
			environment: "prod.eu",
			database: "openlit",
		});
		const filters = settings?.additional_table_filters || "";
		for (const table of TENANT_FILTERED_OTEL_TABLES) {
			expect(filters).toContain(`'${table}':`);
			expect(filters).toContain(`'openlit.${table}':`);
		}
		expect(filters).toContain("IN (\\'\\', \\'proj1\\')");
		expect(filters).toContain("IN (\\'\\', \\'prod.eu\\')");
	});

	it("skips unsafe database names in qualified keys", () => {
		const settings = tenantReadFilterSettings({
			projectId: "proj1",
			environment: "production",
			database: "bad-db'name",
		});
		expect(settings?.additional_table_filters).not.toContain("bad-db");
	});

	it("can be disabled explicitly", () => {
		process.env.OPENLIT_TENANT_READ_FILTER = "false";
		expect(
			tenantReadFilterSettings({ projectId: "proj1", environment: "production", database: "openlit" })
		).toBeUndefined();
	});
});
