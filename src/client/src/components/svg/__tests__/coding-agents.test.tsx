import { render, screen } from "@testing-library/react";
import {
	CodingAgentVendorIcon,
	codingAgentVendorLabel,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";
import type { CodingAgentVendor } from "@/types/agents";

describe("OpenCode coding-agent vendor presentation", () => {
	it("provides the OpenCode label and icon through the shared helpers", () => {
		const vendor = "opencode" satisfies CodingAgentVendor;

		expect(codingAgentVendorLabel(vendor)).toBe("OpenCode");
		expect(hasCodingAgentVendorIcon(vendor)).toBe(true);

		render(<CodingAgentVendorIcon vendor={vendor} className="vendor-icon" />);

		const icon = screen.getByRole("img", { name: "OpenCode" });
		expect(icon).toHaveClass("vendor-icon");
		expect(icon.querySelectorAll("path")).toHaveLength(2);
		expect(
			Array.from(icon.querySelectorAll("path")).every(
				(path) => path.getAttribute("fill") === "currentColor",
			),
		).toBe(true);
	});
});
