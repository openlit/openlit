import {
	ComponentIcon,
	FolderIcon,
	LayoutDashboardIcon,
	type LucideIcon,
} from "lucide-react";

export type DashboardView = {
	key: string;
	label: string;
	href: string;
	icon: LucideIcon;
	tone: string;
};

export const DASHBOARD_VIEWS: DashboardView[] = [
	{
		key: "explorer",
		label: "Explorer",
		href: "/dashboards/explorer",
		icon: FolderIcon,
		tone: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300",
	},
	{
		key: "dashboard",
		label: "Dashboard",
		href: "/dashboards/dashboard",
		icon: LayoutDashboardIcon,
		tone: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300",
	},
	{
		key: "widget",
		label: "Widget",
		href: "/dashboards/widget",
		icon: ComponentIcon,
		tone: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300",
	},
];

export function getActiveDashboardView(pathname: string) {
	const segment = pathname.split("/")[2];
	if (!segment || segment === "explorer") {
		return DASHBOARD_VIEWS[0];
	}
	return DASHBOARD_VIEWS.find((view) => view.key === segment) ?? DASHBOARD_VIEWS[0];
}
