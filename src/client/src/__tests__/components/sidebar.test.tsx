import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "@/components/(playground)/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	SidebarLayoutProvider,
	useSidebarLayout,
} from "@/components/(playground)/sidebar-layout-context";

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
		COMPACT_SIDEBAR_ICON_CLASS: "",
		COMPACT_SIDEBAR_SEARCH_ICON_CLASS: "",
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

function LayoutControls() {
	const { isExpanded, toggleSidebar } = useSidebarLayout();
	return (
		<div>
			<span data-testid="layout-state">
				{isExpanded ? "expanded" : "collapsed"}
			</span>
			<button type="button" onClick={toggleSidebar}>
				Toggle sidebar
			</button>
		</div>
	);
}

function renderSidebar() {
	return render(
		<SidebarLayoutProvider>
			<TooltipProvider>
				<LayoutControls />
				<Sidebar />
			</TooltipProvider>
		</SidebarLayoutProvider>
	);
}

function collapse() {
	fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
}

describe("Sidebar", () => {
	beforeEach(() => {
		pushMock.mockClear();
		pathname = "/home";
		searchParams = "";
		window.localStorage.clear();
	});

	it("shows the Browse/Otter shortcuts when expanded and hides them when collapsed", () => {
		renderSidebar();

		expect(screen.getByTestId("layout-state")).toHaveTextContent("expanded");
		expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Otter" })).toBeInTheDocument();

		collapse();

		expect(screen.getByTestId("layout-state")).toHaveTextContent("collapsed");
		expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Otter" })).not.toBeInTheDocument();
		// Navigation items stay accessible (label kept for screen readers).
		expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
	});

	it("navigates without expanding when clicking a collapsed action item", () => {
		renderSidebar();

		collapse();
		expect(screen.getByTestId("layout-state")).toHaveTextContent("collapsed");

		fireEvent.click(screen.getByRole("link", { name: "Home" }));

		// The rail stays collapsed: navigation should not auto-expand the sidebar.
		expect(screen.getByTestId("layout-state")).toHaveTextContent("collapsed");
	});

	it("opens a secondary panel without expanding when clicking a collapsed section item", () => {
		renderSidebar();

		collapse();
		fireEvent.click(screen.getByRole("button", { name: "R" }));

		expect(screen.getByTestId("layout-state")).toHaveTextContent("collapsed");
		expect(screen.getByRole("link", { name: "Prompt Hub" })).toBeInTheDocument();
		expect(screen.getAllByText("Resources").length).toBeGreaterThanOrEqual(1);
	});

	it("opens command search without expanding from the collapsed search button", () => {
		renderSidebar();

		collapse();
		fireEvent.click(screen.getByRole("button", { name: "Search navigation" }));

		expect(screen.getByTestId("layout-state")).toHaveTextContent("collapsed");
		expect(
			screen.getByPlaceholderText("Search OpenLIT navigation...")
		).toBeInTheDocument();
	});
});
