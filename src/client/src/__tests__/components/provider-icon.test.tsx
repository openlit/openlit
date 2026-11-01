import { existsSync } from "fs";
import { join } from "path";
import { render } from "@testing-library/react";
import { ProviderIcon } from "@/components/svg/providers";

describe("ProviderIcon", () => {
	it("renders the TypeSafe mark for the typesafe provider (case-insensitive)", () => {
		const { container } = render(<ProviderIcon provider="TypeSafe" className="w-5 h-5" />);
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute("aria-label")).toBe("TypeSafe");
		expect(container.querySelector("image")?.getAttribute("href")).toBe(
			"/images/provider/typesafe.png"
		);
	});

	it("ships the static asset the TypeSafe icon points at", () => {
		expect(
			existsSync(join(__dirname, "../../../public/images/provider/typesafe.png"))
		).toBe(true);
	});

	it("renders the Runcrate mark for the runcrate provider", () => {
		const { container } = render(<ProviderIcon provider="runcrate" className="w-5 h-5" />);
		expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Runcrate");
		expect(container.querySelector("image")?.getAttribute("href")).toBe(
			"/images/provider/runcrate.png"
		);
		expect(
			existsSync(join(__dirname, "../../../public/images/provider/runcrate.png"))
		).toBe(true);
	});

	it("still renders nothing for unknown providers", () => {
		const { container } = render(<ProviderIcon provider="not-a-provider" />);
		expect(container.firstChild).toBeNull();
	});
});
