/**
 * @jest-environment jsdom
 */

jest.mock("sonner", () => ({
	toast: { success: jest.fn() },
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		ORGANISATION_ID: "Organisation ID",
		PROJECT_ID: "Project ID",
		ENVIRONMENT_NAME: "Environment",
		COPY_CONTEXT_VALUE: (label: string) => `Copy ${label}`,
		COPIED_TO_CLIPBOARD: "Copied!",
	})),
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { useRootStore } from "@/store";
import OpenLitContextIds from "@/components/(playground)/openlit-context-ids";

describe("OpenLitContextIds", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		Object.assign(navigator, {
			clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
		});
	});

	it("renders organisation, project, and environment with copy actions", async () => {
		(useRootStore as jest.Mock).mockImplementation((selector) =>
			selector({
				organisation: { current: { id: "org_abc123" } },
				project: { current: { id: "proj_xyz789" }, currentEnvironment: "production" },
			})
		);

		render(<OpenLitContextIds />);

		expect(screen.getByText("Organisation ID")).toBeInTheDocument();
		expect(screen.getByText("Project ID")).toBeInTheDocument();
		expect(screen.getByText("Environment")).toBeInTheDocument();
		expect(screen.getByText("production")).toBeInTheDocument();

		fireEvent.click(screen.getByLabelText("Copy Organisation ID"));
		await waitFor(() => {
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith("org_abc123");
			expect(toast.success).toHaveBeenCalledWith("Copied!");
		});
	});

	it("hides when no context values are available", () => {
		(useRootStore as jest.Mock).mockImplementation((selector) =>
			selector({
				organisation: { current: null },
				project: { current: null, currentEnvironment: null },
			})
		);

		const { container } = render(<OpenLitContextIds />);
		expect(container).toBeEmptyDOMElement();
	});
});
