import {
	isVisibleConnectorType,
	VISIBLE_CONNECTOR_TYPES,
} from "@/lib/platform/connectors/visible-types";

describe("isVisibleConnectorType", () => {
	it.each(VISIBLE_CONNECTOR_TYPES)("returns true for %s", (type) => {
		expect(isVisibleConnectorType(type)).toBe(true);
	});

	it("returns false for an unlisted string", () => {
		expect(isVisibleConnectorType("datadog")).toBe(false);
	});

	it("returns false for non-string input via String() coercion", () => {
		expect(isVisibleConnectorType(undefined)).toBe(false);
		expect(isVisibleConnectorType(null)).toBe(false);
		expect(isVisibleConnectorType(42)).toBe(false);
		expect(isVisibleConnectorType({})).toBe(false);
	});
});
