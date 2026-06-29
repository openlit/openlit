import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "@/components/(playground)/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const pushMock = jest.fn();
let pathname = "/home";
let searchParams = "";

jest.mock("next/navigation", () => ({
	usePathname: () => pathname,
	useRouter: () => ({ push: pushMock }),
	useSearchParams: () => new URLSearchParams(searchParams),
}));

jest.mock("@/constants/sidebar", () => {
	const React = require("react");
	const icon = (name: string) => React.createElement("span", { "data-testid": `${name}-icon` });

	return {
		ICON_CLASSES: "size-5",
		SIDEBAR_ITEMS: [
			{
				icon: icon("home"),
				text: "Home",
				link: "/home",
				type: "action",
			},
			{
				title: "Resources",
				type: "section",
				children: [
					{
						icon: icon("prompt"),
						text: "Prompt Hub",
						link: "/prompt-hub",
						type: "action",
					},
				],
			},
		],
	};
});

jest.mock("@/components/(playground)/sidebar/user-actions", () => ({
	__esModule: true,
	default: () => <button>User menu</button>,
}));

jest.mock("@/components/(playground)/sidebar/otter-sidebar", () => ({
	__esModule: true,
	default: () => <div>Otter sidebar</div>,
}));

jest.mock("@/components/(playground)/sidebar/theme-switch", () => ({
	__esModule: true,
	default: () => <button>Theme switch</button>,
}));

jest.mock("@/components/ui/tooltip", () => ({
	TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/command", () => ({
	CommandDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
	CommandInput: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
	CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CommandGroup: ({ children, heading }: { children: React.ReactNode; heading?: string }) => <div aria-label={heading}>{children}</div>,
	CommandItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderSidebar() {
	return render(
		<TooltipProvider>
			<Sidebar />
		</TooltipProvider>
	);
}

describe("Sidebar", () => {
	beforeEach(() => {
		pushMock.mockClear();
		pathname = "/home";
		searchParams = "";
		window.localStorage.clear();
	});

	it("keeps the brand logo rendered and hides brand copy without removing layout space when collapsed", () => {
		renderSidebar();

		expect(screen.getByAltText("OpenLIT logo")).toBeInTheDocument();
		expect(screen.getByText("OpenLIT").parentElement).not.toHaveClass("invisible");

		fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

		expect(screen.getByAltText("OpenLIT logo")).toBeInTheDocument();
		expect(screen.getByText("OpenLIT").parentElement).toHaveClass(
			"invisible",
			"opacity-0",
			"pointer-events-none"
		);
		expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
	});

	it("expands the sidebar when clicking a collapsed action item", () => {
		renderSidebar();

		fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		fireEvent.click(screen.getByRole("link", { name: "Home" }));

		expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
		expect(screen.getByText("OpenLIT").parentElement).not.toHaveClass("invisible");
	});

	it("expands the sidebar and opens a secondary panel when clicking a collapsed section item", () => {
		renderSidebar();

		fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		fireEvent.click(screen.getByRole("button", { name: "R" }));

		expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveClass("right-2");
		expect(screen.getAllByText("Resources")).toHaveLength(2);
		expect(screen.getByRole("link", { name: "Prompt Hub" })).toBeInTheDocument();
	});

	it("expands before opening command search from the collapsed search button", () => {
		renderSidebar();

		fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		fireEvent.click(screen.getByRole("button", { name: "Search navigation" }));

		expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Search OpenLIT navigation...")).toBeInTheDocument();
	});
});
