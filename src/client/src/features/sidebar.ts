import { SidebarActionItem } from "@/types/sidebar";

export type EnterpriseSidebarSection = "monitoring" | "configuration" | "settings";

export function getEnterpriseSidebarItems(
	_section: EnterpriseSidebarSection,
	_iconClasses: string
): SidebarActionItem[] {
	return [];
}
