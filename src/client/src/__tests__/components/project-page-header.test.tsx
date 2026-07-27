import { render, screen } from "@testing-library/react";
import ProjectPageHeader from "@/components/(playground)/organisation/project-page-header";

jest.mock("@/components/(playground)/feature-page-header", () => ({
	__esModule: true,
	default: ({ title, description, leading, actions }: any) => (
		<div>
			{leading}
			<h1>{title}</h1>
			<p>{description}</p>
			{actions}
		</div>
	),
}));

describe("ProjectPageHeader", () => {
	it("renders project identity, back control, and route actions", () => {
		render(<ProjectPageHeader project={{ name: "Production", isCurrent: true, isDefault: true }} />);

		expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Back to Organisation" })).toHaveAttribute("href", "/organisation");
		expect(screen.getByRole("link", { name: /Overview/ })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Connectors/ })).toBeInTheDocument();
	});

	it("uses the loading title when no project is available", () => {
		render(<ProjectPageHeader />);

		expect(screen.getByRole("heading", { name: "Loading project" })).toBeInTheDocument();
	});
});
