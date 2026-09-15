import {
	__resetScannerBootstrapForTests,
	ensureScannerAdaptersRegistered,
} from "@/lib/platform/connectors/scanner/bootstrap";
import {
	__resetScannerRegistryForTests,
	createScannerAdapter,
	hasScannerAdapterFactory,
	listScannerTypeDescriptors,
} from "@/lib/platform/connectors/scanner/registry";
import {
	__resetConnectorRegistryForTests,
	listConnectorTypes,
} from "@/lib/platform/connectors/registry";
import { TrustablAdapter } from "@/lib/platform/connectors/scanner/trustabl/adapter";
import type { ScannerSourceDescriptor } from "@/lib/platform/connectors/scanner/types";

jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));

beforeEach(() => {
	__resetScannerRegistryForTests();
	__resetScannerBootstrapForTests();
	__resetConnectorRegistryForTests();
});

describe("scanner connector bootstrap", () => {
	it("registers Trustabl exactly once", () => {
		ensureScannerAdaptersRegistered();
		ensureScannerAdaptersRegistered();
		expect(hasScannerAdapterFactory("trustabl")).toBe(true);
		expect(listScannerTypeDescriptors().map((item) => item.type)).toEqual(["trustabl"]);
	});

	it("creates a Trustabl adapter from a descriptor", () => {
		ensureScannerAdaptersRegistered();
		const descriptor: ScannerSourceDescriptor = {
			type: "trustabl",
			id: "scanner:1",
			settings: { target: "https://github.com/acme/checkout-agent" },
			name: "Trustabl",
		};
		expect(createScannerAdapter(descriptor)).toBeInstanceOf(TrustablAdapter);
	});

	it("exposes scanner types through the generic connector registry", () => {
		ensureScannerAdaptersRegistered();
		expect(listConnectorTypes("scanner").map((item) => item.type)).toEqual(["trustabl"]);
		expect(listConnectorTypes("memory")).toHaveLength(0);
	});

	it("every registered type exposes a valid config schema", () => {
		ensureScannerAdaptersRegistered();
		for (const descriptor of listScannerTypeDescriptors()) {
			expect(descriptor.configFields.length).toBeGreaterThan(0);
			for (const field of descriptor.configFields) {
				expect(field.key).toBeTruthy();
				expect(field.label).toBeTruthy();
				expect(["settings", "credentials"]).toContain(field.group);
			}
		}
	});
});
